/** @format */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as sdk from "./index";
import { splitProps, mergeAuto, init, serializeInlineKeyboard, MAX_PROP_STRING_LEN } from "./index";

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
    expect(mergeAuto(true)).toEqual({ page: true, nav: true, clicks: true, forms: true, errors: true });
    expect(mergeAuto(false)).toEqual({ page: false, nav: false, clicks: false, forms: false, errors: false });
    expect(mergeAuto({ page: true })).toEqual({ page: true, nav: false, clicks: false, forms: false, errors: false });
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

  it("init returns client & flush calls fetch with initData", async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: true });
    (globalThis as any).fetch = mockFetch;

    const c = init({ projectId: "p", botId: "b", auth: () => ({ initData: "xyz" }) });

    c.track("evt", { hello: "world" });

    await c.flush();

    expect(mockFetch).toHaveBeenCalled();

    const calledBody = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(calledBody.Auth.InitData).toBe("xyz");
  });
});
