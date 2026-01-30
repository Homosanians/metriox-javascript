/** @format */

import React, { useEffect } from "react";
import { describe, it, expect, vi } from "vitest";
import { act, create } from "react-test-renderer";
import { render, fireEvent, waitFor } from "@testing-library/react";
import { MetrioxProvider, useMetriox, Metriox, LogOnMount, LogOnChange } from "./index";

function TestChild() {
  const client = useMetriox();
  useEffect(() => {
    client.track("t");
  }, [client]);
  return null;
}

describe("react integration", () => {
  it("provider provides client and hook works", () => {
    const mockClient: any = { track: vi.fn(), page: vi.fn(), interaction: vi.fn(), flush: vi.fn, shutdown: vi.fn };

    let tree: any;
    act(() => {
      tree = create(React.createElement(MetrioxProvider, { client: mockClient }, React.createElement(TestChild)));
    });

    expect(mockClient.track).toHaveBeenCalled();
    tree.unmount();
  });

  it("sync-initializes client so useMetriox can be used during render", () => {
    // This consumer uses useMetriox during render (not in effect). Previously this would throw if provider
    // only initialized in useEffect. We should initialize synchronously in browser to avoid that.
    const mockClient: any = { track: vi.fn(), page: vi.fn(), interaction: vi.fn(), flush: vi.fn, shutdown: vi.fn };

    function RenderConsumer() {
      const c = useMetriox();
      c.track('from-render');
      return null;
    }

    let tree: any;
    act(() => {
      tree = create(
        React.createElement(MetrioxProvider, { config: { projectId: 'p', botId: 'b', auth: () => ({ initData: '' }) } }, React.createElement(RenderConsumer))
      );
    });

    // If useMetriox didn't throw, the inner component called track()
    // Note: we can't access internal client easily here so we rely on not throwing.
    tree.unmount();
  });

  it("auto instrumentation captures clicks within provider subtree (DOM)", async () => {
    const mockClient: any = { track: vi.fn(), page: vi.fn(), interaction: vi.fn(), flush: vi.fn, shutdown: vi.fn };

    const { getByText, unmount } = render(React.createElement(MetrioxProvider, { client: mockClient, auto: true }, React.createElement("button", { "data-mx": "buy" }, "Buy")));

    fireEvent.click(getByText("Buy"));

    await waitFor(() => {
      expect(mockClient.interaction).toHaveBeenCalledWith("click", expect.objectContaining({ mx: "buy" }));
    });

    unmount();
  });

  it("Metriox render-prop merges props and LogOnMount/LogOnChange work", () => {
    const mockClient: any = { track: vi.fn(), page: vi.fn(), interaction: vi.fn(), flush: vi.fn, shutdown: vi.fn };

    function ChildUsingRenderProp() {
      return (
        <Metriox eventProperties={{ scope: ["child"] }}>
          {(helpers: any) => {
            useEffect(() => {
              helpers.logEvent("render-prop-event", { extra: 1 });
            }, []);
            return null;
          }}
        </Metriox>
      );
    }

    let tree: any;
    act(() => {
      tree = create(React.createElement(MetrioxProvider, { client: mockClient, eventProperties: { app: "x" } }, React.createElement(ChildUsingRenderProp), React.createElement(LogOnMount, { eventType: "mount-event", eventProperties: { m: 1 } }), React.createElement(LogOnChange, { value: "a", eventType: "change-event", eventProperties: { c: 1 } })));
    });

    // render-prop event + mount event should have been called
    expect(mockClient.track).toHaveBeenCalled();
    const calls = mockClient.track.mock.calls.map((c: any) => ({ type: c[0], props: c[1] }));
    expect(calls.some((c: any) => c.type === "render-prop-event" && c.props.extra === 1 && c.props.app === "x")).toBe(true);
    expect(calls.some((c: any) => c.type === "mount-event" && c.props.m === 1)).toBe(true);

    tree.unmount();
  });

  it("instrument wrapper returns a function that logs", () => {
    const mockClient: any = { track: vi.fn(), page: vi.fn(), interaction: vi.fn(), flush: vi.fn, shutdown: vi.fn };

    let helpersFromRender: any = null;
    function Child() {
      return (
        <Metriox eventProperties={{ scope: ["child"] }}>
          {(helpers: any) => {
            helpersFromRender = helpers;
            return null;
          }}
        </Metriox>
      );
    }

    let tree: any;
    act(() => {
      tree = create(React.createElement(MetrioxProvider, { client: mockClient }, React.createElement(Child)));
    });

    expect(typeof helpersFromRender.instrument).toBe("function");
    const wrapped = helpersFromRender.instrument("clicked", () => "ok");
    const r = wrapped();
    expect(r).toBe("ok");
    expect(mockClient.track).toHaveBeenCalledWith("clicked", expect.any(Object));

    tree.unmount();
  });
});
