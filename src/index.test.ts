/** @format */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as sdk from "./index";
import { splitProps, mergeAuto, init } from "./index";

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

  it("mergeAuto merges correctly", () => {
    expect(mergeAuto(true)).toEqual({ page: true, nav: true, clicks: true, forms: true, errors: true });
    expect(mergeAuto(false)).toEqual({ page: false, nav: false, clicks: false, forms: false, errors: false });
    expect(mergeAuto({ page: true })).toEqual({ page: true, nav: false, clicks: false, forms: false, errors: false });
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
