/**
 * React integration for MetrioxTG
 *
 * Usage:
 *   import { MetrioxProvider, useMetriox } from 'metriox-javascript/react';
 *
 * Provide either a `client` (already initialized) or a `config` to initialize the SDK.
 */

import React, { createContext, useContext, useEffect, useRef, useState } from "react";
import { init as sdkInit } from "../index.js";

const MetrioxContext = createContext(null);

export function MetrioxProvider({ client: clientProp, config, children }) {
  const [client, setClient] = useState(clientProp ?? null);
  const clientRef = useRef(clientProp ?? null);

  useEffect(() => {
    clientRef.current = client;
  }, [client]);

  useEffect(() => {
    if (clientProp) {
      setClient(clientProp);
      return;
    }
    if (!config) return;
    const c = sdkInit(config);
    setClient(c);
    return () => {
      try {
        c.shutdown && c.shutdown();
      } catch {}
    };
  }, [clientProp, config]);

  return React.createElement(MetrioxContext.Provider, { value: client }, children);
}

export function useMetriox() {
  const client = useContext(MetrioxContext);
  if (!client) throw new Error("useMetriox must be used within a MetrioxProvider");
  return client;
}

export function usePageView(name = "page_view", props = {}) {
  const client = useContext(MetrioxContext);
  useEffect(() => {
    if (!client) return;
    client.page(name, props);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, name, JSON.stringify(props)]);
}

export function withMetriox(Component) {
  return function Wrapped(props) {
    const client = useMetriox();
    return React.createElement(Component, Object.assign({}, props, { metriox: client }));
  };
}
