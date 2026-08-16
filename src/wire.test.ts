/** @format */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { createServer, type Server } from "node:http";
import { init } from "./index";

// The other specs replace globalThis.fetch with a mock, which proves what the SDK *intends* to send
// but never that a real request survives serialization, that a real status code is read correctly,
// or that a real body round-trips. This one stands up an HTTP server implementing the ingest
// contract and drives the SDK at it over the loopback interface.
//
// It stops short of the live backend deliberately: ingest verifies initData against Telegram's
// production Ed25519 public key, so a valid signature cannot be produced locally at all. What is
// checkable without Telegram is the wire contract and the delivery policy — which is this file.

type Received = { path: string; body: any };

let server: Server;
let endpoint: string;
let received: Received[] = [];

/** Status the stub answers with; taking the request number lets a test vary it per attempt. */
let respond: (n: number) => number = () => 202;
let requestCount = 0;

function diagnosticsBody(events: any[]) {
  return JSON.stringify({
    accepted: events.length,
    rejected: 0,
    not_consumed_duplicated: 0,
    diagnostics_truncated: false,
    diagnostics: [],
  });
}

beforeAll(async () => {
  server = createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      const body = JSON.parse(raw);
      received.push({ path: req.url || "", body });

      const status = respond(++requestCount);
      res.writeHead(status, { "content-type": "application/json" });
      res.end(status === 202 ? diagnosticsBody(body.Events || []) : JSON.stringify({ error: "nope" }));
    });
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const addr = server.address();
  if (typeof addr === "string" || addr === null) throw new Error("expected a TCP address");
  endpoint = `http://127.0.0.1:${addr.port}/tg/webapp`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

beforeEach(() => {
  received = [];
  requestCount = 0;
  respond = () => 202;
});

describe("wire contract over a real connection", () => {
  it("posts the shape the endpoint declares, and nothing it does not", async () => {
    const client = init({ botId: "11111111-1111-1111-1111-111111111111", auth: { initData: "signed" }, endpoint });
    client.track("purchase_completed", { price: 299, plan: "premium", trial: false }, { type: "payment" });
    await client.flush();

    expect(received).toHaveLength(1);
    const { body } = received[0];

    expect(body.BotId).toBe("11111111-1111-1111-1111-111111111111");
    expect(body.Auth.InitData).toBe("signed");

    // Fields the WebApp endpoint does not have. Sending them is not merely useless — a reader of the
    // request would reasonably conclude they mean something.
    expect(body.ProjectId).toBeUndefined();
    expect(body.Events[0].EventOrigin).toBeUndefined();
    expect(body.Events[0].PlatformUserId).toBeUndefined();
    expect(body.Events[0].PropsFloat).toBeUndefined();

    const ev = body.Events[0];
    expect(ev.EventType).toBe("payment");
    expect(ev.EventName).toBe("purchase_completed");
    expect(new Date(ev.EventDate).toString()).not.toBe("Invalid Date");
    expect(ev.PropsLong.price).toBe(299);
    expect(ev.PropsString.plan).toBe("premium");
    expect(ev.PropsBool.trial).toBe(false);
  });

  it("delivers many batches on one initData, which is the whole point of the backend fix", async () => {
    // Telegram fixes initData at launch and never refreshes it, so every batch in a session carries
    // the same string. The ingest used to reject the second as a replay; the SDK must keep sending,
    // and each batch must arrive whole.
    const client = init({ botId: "b", auth: { initData: "one-and-only" }, endpoint, context: false });

    for (let batch = 0; batch < 3; batch++) {
      client.track(`evt_${batch}`);
      await client.flush();
    }

    expect(received).toHaveLength(3);
    expect(received.map((r) => r.body.Auth.InitData)).toEqual(["one-and-only", "one-and-only", "one-and-only"]);
    expect(received.map((r) => r.body.Events[0].EventName)).toEqual(["evt_0", "evt_1", "evt_2"]);
  });

  it("retries a 503 and delivers the same batch, losing nothing", async () => {
    respond = (n) => (n === 1 ? 503 : 202);

    const client = init({ botId: "b", auth: { initData: "s" }, endpoint, context: false, retryCount: 1, retryBaseMs: 1 });
    client.track("survives");
    await client.flush();

    expect(received).toHaveLength(2);
    expect(received[1].body.Events[0].EventName).toBe("survives");
  });

  it("abandons a 401 instead of blocking every later event behind it", async () => {
    respond = (n) => (n === 1 ? 401 : 202);

    const client = init({ botId: "b", auth: { initData: "s" }, endpoint, context: false, retryCount: 0 });
    client.track("refused");
    await client.flush();

    // One attempt, no retry: the server gave a verdict.
    expect(received).toHaveLength(1);

    // And the queue moved on rather than re-offering the same doomed batch.
    client.track("later");
    await client.flush();
    expect(received).toHaveLength(2);
    expect(received[1].body.Events.map((e: any) => e.EventName)).toEqual(["later"]);
  });

  it("splits an oversized batch across requests rather than losing it", async () => {
    // 19 against the default maxBatch of 20: reaching maxBatch fires its own flush, and racing it
    // makes the request count meaningless. 19 max-length events are ~86KB, past the cap regardless.
    const client = init({ botId: "b", auth: { initData: "s" }, endpoint });
    for (let i = 0; i < 19; i++) client.track("evt", { blob: "y".repeat(4096) });

    await client.flush();
    await client.flush();

    const delivered = received.flatMap((r) => r.body.Events);
    expect(received.length).toBeGreaterThan(1);
    expect(delivered).toHaveLength(19);
  });

  it("carries the Mini App context the dashboard segments on", async () => {
    const client = init({ botId: "b", auth: { initData: "s" }, endpoint });
    client.track("evt");
    await client.flush();

    const props = received[0].body.Events[0].PropsString;
    expect(props.sdk).toBe("metriox-tg-webapp");
    expect(props.sdk_version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(props.session_id).toBeTruthy();
  });
});
