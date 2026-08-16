/** @format */

// @vitest-environment node
//
// Every other spec runs under jsdom, so `window` and `document` always exist and the server-render
// path is never touched. That is the path Next, Nuxt, SvelteKit and Angular Universal all take
// first: they evaluate the module and run component setup on the server, where neither global is
// defined. One environment: node spec covers the failure mode for all four at once.

import { describe, it, expect, vi, afterEach } from "vitest";
import { init, collectStaticContext, collectDynamicContext } from "./index";

const config = { botId: "b", auth: { initData: "" } };

describe("server-side rendering", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("has no DOM to speak of", () => {
    // Guards the spec itself: if the environment comment is ever dropped, these fail loudly rather
    // than letting the suite pass while silently testing jsdom all over again.
    expect(typeof window).toBe("undefined");
    expect(typeof document).toBe("undefined");
  });

  it("init does not throw without a DOM", () => {
    expect(() => init(config)).not.toThrow();
  });

  it("init does not throw with auto instrumentation requested", () => {
    // `auto: true` on a Nuxt or SvelteKit page is the ordinary way to write it, and the listeners
    // it attaches are exactly what has no home on the server.
    expect(() => init({ ...config, auto: true })).not.toThrow();
  });

  it("recording an event on the server is inert, not fatal", () => {
    const client = init(config);

    expect(() => client.track("evt", { a: 1 })).not.toThrow();
    expect(() => client.page("page_view")).not.toThrow();
    expect(() => client.interaction("click")).not.toThrow();
  });

  it("flush sends nothing, because a server render has no user session to attribute", async () => {
    const fetchMock = vi.fn();
    (globalThis as any).fetch = fetchMock;

    const client = init(config);
    client.track("evt");
    await client.flush();

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("shutdown does not throw when nothing was ever attached", () => {
    const client = init({ ...config, auto: true });
    expect(() => client.shutdown()).not.toThrow();
  });

  it("context collection degrades to empty rather than throwing", () => {
    expect(() => collectStaticContext("session")).not.toThrow();
    expect(() => collectDynamicContext()).not.toThrow();
  });
});
