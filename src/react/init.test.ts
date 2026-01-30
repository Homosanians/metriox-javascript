/** @format */

import { describe, it, expect, vi, afterEach } from "vitest";
import { initOnce, getInstance, resetInstanceForTests } from "./init";
import { init as sdkInit } from "../index";

describe("init singleton", () => {
  afterEach(() => resetInstanceForTests());

  it("initOnce returns same instance", () => {
    const c1 = initOnce({ projectId: "p", botId: "b", auth: () => ({ initData: "" }) });
    const c2 = initOnce({ projectId: "p", botId: "b", auth: () => ({ initData: "" }) });
    expect(c1).toBe(c2);
  });

  it("getInstance throws before init", () => {
    resetInstanceForTests();
    expect(() => getInstance()).toThrow();
  });
});
