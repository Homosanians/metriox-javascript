/** @format */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as sdk from "./index";
import { splitProps, mergeAuto, init, serializeInlineKeyboard, MAX_PROP_STRING_LEN, EVENT_TYPES, coerceEventType, classifyStatus } from "./index";

console.log("sdk keys", Object.keys(sdk));

describe("helpers", () => {
  it("splitProps splits types correctly", () => {
    const out = splitProps({ a: "x", b: true, c: 123, d: { x: 1 } });
    expect(out.PropsString).toBeDefined();
    expect(out.PropsBool).toBeDefined();
    expect(out.PropsLong).toBeDefined();
    expect(out.PropsString.a).toBe("x");
    expect(out.PropsBool.b).toBe(true);
    expect(out.PropsLong.c).toBe(123);
  });

  it("splitProps clamps strings at the server's limit, not below it", () => {
    // The clamp used to be 2048 — half the server's 4096 — which silently cut compact $tg blobs
    // (64 entity spans reach ~2.6k characters) into invalid JSON that reads back as no formatting.
    const exact = "x".repeat(MAX_PROP_STRING_LEN);
    const over = "x".repeat(MAX_PROP_STRING_LEN + 500);

    expect(MAX_PROP_STRING_LEN).toBe(4096);
    expect(splitProps({ a: exact }).PropsString.a).toHaveLength(MAX_PROP_STRING_LEN);
    expect(splitProps({ a: over }).PropsString.a).toHaveLength(MAX_PROP_STRING_LEN);
    expect(splitProps({ a: "x".repeat(3000) }).PropsString.a).toHaveLength(3000);
  });

  it("mergeAuto merges correctly", () => {
    expect(mergeAuto(true)).toEqual({ page: true, nav: true, clicks: true, forms: true, errors: true, tg: true });
    expect(mergeAuto(false)).toEqual({ page: false, nav: false, clicks: false, forms: false, errors: false, tg: false });
    expect(mergeAuto({ page: true })).toEqual({ page: true, nav: false, clicks: false, forms: false, errors: false, tg: false });
  });
});

describe("event type vocabulary", () => {
  it("keeps the canonical categories the server stores", () => {
    for (const t of EVENT_TYPES) expect(coerceEventType(t)).toBe(t);
  });

  it("coerces what the server would coerce, including this SDK's own former values", () => {
    // "custom" and "page" shipped for a long time and were never $event.type values; the gate
    // rewrote both to "platform" and warned on every event that carried them (audit A7).
    expect(coerceEventType("custom")).toBe("platform");
    expect(coerceEventType("page")).toBe("platform");
    expect(coerceEventType(undefined)).toBe("platform");
    expect(coerceEventType("Interaction")).toBe("platform");
  });
});

describe("classifyStatus", () => {
  it("stops retrying a batch the server has permanently refused", () => {
    // The ingest returns 4xx specifically so a bad batch stops being retried. Re-queueing these
    // blocked every later event behind a batch that could never pass.
    for (const s of [400, 401, 402, 403, 409, 413]) expect(classifyStatus(s)).toBe("drop");
  });

  it("retries the two 4xx that mean 'later', and every 5xx", () => {
    expect(classifyStatus(408)).toBe("retry");
    expect(classifyStatus(429)).toBe("retry");
    expect(classifyStatus(500)).toBe("retry");
    expect(classifyStatus(503)).toBe("retry");
  });

  it("treats the whole 2xx range as sent", () => {
    // The endpoint answers 202 Accepted, not 200.
    expect(classifyStatus(200)).toBe("sent");
    expect(classifyStatus(202)).toBe("sent");
  });
});

describe("serializeInlineKeyboard", () => {
  it("captures callback payload and url with their kind, flattening rows in order", () => {
    const json = serializeInlineKeyboard({
      inline_keyboard: [
        [
          { text: "Buy", callback_data: "buy" },
          { text: "Open", url: "https://x" },
        ],
        [{ text: "Next", callback_data: "n" }],
      ],
    });

    expect(JSON.parse(json!)).toEqual([
      { text: "Buy", callback_data: "buy" },
      { text: "Open", url: "https://x" },
      { text: "Next", callback_data: "n" },
    ]);
  });

  it("skips buttons that carry neither callback_data nor url", () => {
    const json = serializeInlineKeyboard({ inline_keyboard: [[{ text: "Share" }, { text: "Buy", callback_data: "b" }]] });

    expect(JSON.parse(json!)).toEqual([{ text: "Buy", callback_data: "b" }]);
  });

  it("returns null when there is nothing to record", () => {
    expect(serializeInlineKeyboard(null)).toBeNull();
    expect(serializeInlineKeyboard(undefined)).toBeNull();
    expect(serializeInlineKeyboard({ inline_keyboard: [] })).toBeNull();
    expect(serializeInlineKeyboard({ inline_keyboard: [[{ text: "Share" }]] })).toBeNull();
  });
});

describe("init & transport", () => {
  let originalFetch: any;

  beforeEach(() => {
    originalFetch = (globalThis as any).fetch;
  });

  afterEach(() => {
    (globalThis as any).fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("init throws on missing config", () => {
    // @ts-ignore
    expect(() => init({})).toThrow();
  });

  it("init no longer demands a projectId the server refuses to trust", () => {
    // The endpoint has no ProjectId field: it resolves the project from the bot, deliberately, so
    // that a caller cannot write into someone else's project or bill it.
    expect(() => init({ botId: "b", auth: () => ({ initData: "" }) })).not.toThrow();
  });

  it("init returns client & flush calls fetch with initData", async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: true, status: 202 });
    (globalThis as any).fetch = mockFetch;

    const c = init({ botId: "b", auth: () => ({ initData: "xyz" }) });

    c.track("evt", { hello: "world" });

    await c.flush();

    expect(mockFetch).toHaveBeenCalled();

    const calledBody = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(calledBody.Auth.InitData).toBe("xyz");
    expect(calledBody.ProjectId).toBeUndefined();
  });

  it("sends canonical event types and the context block", async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: true, status: 202 });
    (globalThis as any).fetch = mockFetch;

    const c = init({ botId: "b", auth: { initData: "xyz" } });

    c.track("purchase_completed", { price: 299 }, { type: "payment" });
    c.track("whatever");
    c.interaction("click");
    c.page("page_view");

    await c.flush();

    const events = JSON.parse(mockFetch.mock.calls[0][1].body).Events;
    expect(events.map((e: any) => e.EventType)).toEqual(["payment", "platform", "interaction", "platform"]);

    // One launch, one session id, and a sequence that survives batching.
    const sessions = new Set(events.map((e: any) => e.PropsString.session_id));
    expect(sessions.size).toBe(1);
    expect(events.map((e: any) => e.PropsLong.seq)).toEqual([0, 1, 2, 3]);
    expect(events[0].PropsString.sdk).toBe("metriox-tg-webapp");
  });

  it("re-queues a batch on 5xx and abandons it on a terminal 4xx", async () => {
    const server = vi.fn().mockResolvedValue({ ok: false, status: 503 });
    (globalThis as any).fetch = server;

    const c = init({ botId: "b", auth: { initData: "xyz" }, retryCount: 0, context: false });
    c.track("evt");
    await c.flush();

    // Still held, so a flush that the server could not answer sends it again.
    server.mockResolvedValue({ ok: false, status: 401 });
    await c.flush();
    expect(JSON.parse(server.mock.calls[1][1].body).Events).toHaveLength(1);

    // 401 is a verdict, not a hiccup: the batch is gone rather than blocking the queue forever.
    server.mockResolvedValue({ ok: true, status: 202 });
    await c.flush();
    expect(server).toHaveBeenCalledTimes(2);
  });
});
