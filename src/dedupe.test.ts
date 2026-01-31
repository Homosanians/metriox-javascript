/** @format */

import { describe, it, expect } from "vitest";
import { shouldSendOnce, markSent, makeKey, PREFIX, StorageAdapter } from "./dedupe";

function makeMemoryAdapter() {
  const store = new Map<string, string>();
  const adapter: StorageAdapter = {
    get(key: string) {
      return store.has(key) ? store.get(key)! : null;
    },
    set(key: string, value: string) {
      store.set(key, value);
    },
    remove(key: string) {
      store.delete(key);
    },
  };
  return { adapter, store } as any;
}

describe("dedupe helpers", () => {
  it("should allow first send and then suppress second within TTL", async () => {
    const { adapter, store } = makeMemoryAdapter();
    const key = makeKey(PREFIX, "a:b");
    const ok1 = await shouldSendOnce(adapter, key, 1000);
    expect(ok1).toBe(true);
    await markSent(adapter, key, 1000);
    const ok2 = await shouldSendOnce(adapter, key, 1000);
    expect(ok2).toBe(false);
  });

  it("should respect expiry TTL", async () => {
    const { adapter, store } = makeMemoryAdapter();
    const key = makeKey(PREFIX, "x:y");
    await markSent(adapter, key, 1);
    // wait for expiry
    await new Promise((r) => setTimeout(r, 5));
    const ok = await shouldSendOnce(adapter, key, 1);
    expect(ok).toBe(true);
  });

  it("init + track honors session mode using sessionStorage", async () => {
    sessionStorage.clear();
    const { init } = await import("./index");
    const c: any = init({ projectId: "p", botId: "b", auth: () => ({ initData: "" }), dedupe: { mode: "session" } });

    c.track("x");
    await new Promise((r) => setTimeout(r, 0));
    c.track("x");
    await new Promise((r) => setTimeout(r, 0));

    // sessionStorage should contain one dedupe key
    let count = 0;
    for (let i = 0; i < sessionStorage.length; i++) {
      const k = sessionStorage.key(i) || "";
      if (k.startsWith("mx:dedupe:")) count++;
    }
    expect(count).toBe(1);
  });
});
