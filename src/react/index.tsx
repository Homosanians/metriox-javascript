/** @format */

import React, { createContext, useContext, useEffect, useRef, useState, useMemo } from "react";
import { init as sdkInit, Config, MetrioxClient } from "../index";

const MetrioxContext = createContext<MetrioxClient | null>(null);
const EventContext = createContext<Record<string, any> | null>(null);

export type EventProps = Record<string, any> | ((inherited: Record<string, any>) => Record<string, any>);

export interface MetrioxProviderProps {
  client?: MetrioxClient;
  config?: Config;
  children?: React.ReactNode;
  // default event properties applied to all events (can be object or function)
  eventProperties?: EventProps;
  // opt-in auto instrumentation for elements inside the provider
  auto?: boolean;
}

export function MetrioxProvider({ client: clientProp, config, children, eventProperties, auto = false }: MetrioxProviderProps) {
  // If a client is passed use it. Otherwise when running in the browser initialize SDK synchronously so
  // consumers that call `useMetriox()` during initial render don't throw.
  const createdClientRef = React.useRef(false);

  const initialClient = ((): MetrioxClient | null => {
    if (clientProp) return clientProp;
    if (typeof window === "undefined") return null; // avoid initializing during SSR
    if (!config) return null;
    // sync init in browser
    const c = sdkInit(config);
    createdClientRef.current = true;
    return c;
  })();

  const [client, setClient] = useState<MetrioxClient | null>(initialClient);
  const clientRef = useRef<MetrioxClient | null>(initialClient ?? null);
  const containerRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    clientRef.current = client;
  }, [client]);

  // If the consumer passes a `client` prop after mount, prefer it and clean up our created client if any.
  useEffect(() => {
    if (clientProp) {
      if (createdClientRef.current && client && client.shutdown) {
        try {
          client.shutdown();
        } catch {}
        createdClientRef.current = false;
      }
      setClient(clientProp);
      return;
    }

    // If we didn't create a client synchronously, but config appears after mount, initialize then.
    if (!client && config && typeof window !== "undefined") {
      const c = sdkInit(config);
      setClient(c);
      createdClientRef.current = true;
      return () => {
        try {
          c.shutdown && c.shutdown();
        } catch {}
      };
    }

    return;
  }, [clientProp, config]);

  // Ensure we shutdown any client we created when the provider unmounts
  useEffect(() => {
    return () => {
      if (createdClientRef.current && client && client.shutdown) {
        try {
          client.shutdown();
        } catch {}
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // compute top-level event properties
  const topProps = useMemo(() => (typeof eventProperties === "function" ? eventProperties({}) : (eventProperties ?? {})), [eventProperties]);

  // Auto instrumentation: capture clicks / submits within provider subtree when `auto` is true
  useEffect(() => {
    if (!auto || !client) return;
    const root = containerRef.current;
    if (!root) return;

    const onClick = (e: Event) => {
      const el = (e.target as Element | null)?.closest?.("[data-mx]");
      if (!el || !root.contains(el)) return;
      const mx = el.getAttribute("data-mx") || "";
      client.interaction("click", { mx, tag: el.tagName, id: el.id || "" });
    };

    const onSubmit = (e: Event) => {
      const form = e.target as HTMLFormElement | null;
      if (!form || !root.contains(form)) return;
      client.interaction("form_submit", { formId: form.id || "", method: form.method || "", action: form.action || "" });
    };

    root.addEventListener("click", onClick, true);
    root.addEventListener("submit", onSubmit, true);

    return () => {
      try {
        root.removeEventListener("click", onClick, true);
        root.removeEventListener("submit", onSubmit, true);
      } catch {}
    };
  }, [auto, client]);

  const providerContent = (
    <MetrioxContext.Provider value={client}>
      <EventContext.Provider value={topProps}>{children}</EventContext.Provider>
    </MetrioxContext.Provider>
  );

  // If auto is enabled we must render an element to scope listeners; otherwise render children directly
  if (auto) {
    return <div ref={(el) => (containerRef.current = el)}>{providerContent}</div>;
  }

  return providerContent;
}

export function useMetriox() {
  const client = useContext(MetrioxContext);
  if (!client) throw new Error("useMetriox must be used within a MetrioxProvider");
  return client;
}

// convenience hook for logging events with merged props
export function useLogEvent() {
  const client = useMetriox();
  const inherited = useContext(EventContext) ?? {};

  function evaluate(ep: EventProps | undefined) {
    if (!ep) return {};
    return typeof ep === "function" ? ep(inherited) : ep;
  }

  function logEvent(eventType: string, props?: Record<string, any>) {
    const ev = Object.assign({}, inherited, evaluate(props));
    client.track(eventType, ev);
  }

  function instrument<T extends any[]>(eventType: string, fn?: (...args: T) => any) {
    return function wrapped(...args: T) {
      try {
        logEvent(eventType);
      } catch {}
      if (typeof fn === "function") return fn(...args);
    };
  }

  return { logEvent, instrument };
}

export function usePageView(name = "page_view", props: Record<string, any> = {}) {
  const client = useContext(MetrioxContext);
  useEffect(() => {
    if (!client) return;
    client.page(name, props);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, name, JSON.stringify(props)]);
}

export function withMetriox<P extends object>(Component: React.ComponentType<P & { metriox: MetrioxClient }>) {
  return function Wrapped(props: P) {
    const client = useMetriox();
    return React.createElement(Component, Object.assign({}, props, { metriox: client }));
  };
}

// Metriox component provides scoped event properties and render-prop helpers
export interface MetrioxProps {
  eventProperties?: EventProps;
  debounceInterval?: number; // reserved for future use
  children?: React.ReactNode | ((helpers: { logEvent: (t: string, p?: Record<string, any>) => void; instrument: any }) => React.ReactNode);
}

export function Metriox({ eventProperties, children }: MetrioxProps) {
  const inherited = useContext(EventContext) ?? {};
  const client = useContext(MetrioxContext);
  const evaluated = typeof eventProperties === "function" ? eventProperties(inherited) : (eventProperties ?? {});

  const merged = Object.assign({}, inherited, evaluated);

  const helpers = {
    logEvent(eventType: string, props?: Record<string, any>) {
      if (!client) return;
      client.track(eventType, Object.assign({}, merged, props ?? {}));
    },
    instrument(eventType: string, fn?: (...args: any[]) => any) {
      return function wrapped(...args: any[]) {
        try {
          helpers.logEvent(eventType);
        } catch {}
        if (typeof fn === "function") return fn(...args);
      };
    },
  };

  if (typeof children === "function") return <EventContext.Provider value={merged}>{children(helpers)}</EventContext.Provider>;
  return <EventContext.Provider value={merged}>{children}</EventContext.Provider>;
}

export type DedupeProp = boolean | "once" | "session" | { mode?: "once" | "session"; key?: string; ttlMs?: number };

export function LogOnMount({ eventType, eventProperties, dedupe }: { eventType: string; eventProperties?: Record<string, any>; dedupe?: DedupeProp }) {
  const client = useMetriox();
  const inherited = useContext(EventContext) ?? {};

  function evaluate(ep: EventProps | undefined) {
    if (!ep) return {};
    return typeof ep === "function" ? ep(inherited) : ep;
  }

  useEffect(() => {
    if (!client) return;
    const ev = Object.assign({}, inherited, evaluate(eventProperties));

    // normalize dedupe prop
    let opt: any = {};
    if (dedupe) {
      if (dedupe === true || dedupe === "once" || (dedupe as any).mode === "once") {
        opt.dedupe = "once";
      } else if (dedupe === "session" || (dedupe as any).mode === "session") {
        opt.dedupe = "session";
      }
      if (typeof dedupe === "object") {
        if ((dedupe as any).key) opt.dedupeKey = (dedupe as any).key;
        if ((dedupe as any).ttlMs) opt.dedupeTtlMs = (dedupe as any).ttlMs;
      }
    }

    try {
      client.track(eventType, ev, opt);
    } catch {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return null;
}

export function LogOnChange<T>({ value, eventType, eventProperties }: { value: T; eventType: string; eventProperties?: Record<string, any> }) {
  const { logEvent } = useLogEvent();
  const prevRef = useRef<T | undefined>(undefined);

  useEffect(() => {
    if (prevRef.current === undefined) {
      prevRef.current = value;
      return;
    }
    if (prevRef.current !== value) {
      logEvent(eventType, eventProperties);
    }
    prevRef.current = value;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  return null;
}

export default {
  MetrioxProvider,
  useMetriox,
  useLogEvent,
  Metriox,
  LogOnMount,
  LogOnChange,
};
