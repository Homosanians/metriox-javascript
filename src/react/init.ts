/** @format */

import { init as sdkInit, Config, MetrioxClient } from "../index";

let instance: MetrioxClient | null = null;

export function initOnce(config: Config): MetrioxClient {
  if (!instance) {
    instance = sdkInit(config);
  }
  return instance;
}

export function getInstance(): MetrioxClient {
  if (!instance) throw new Error("Metriox not initialized. Call initOnce(config) or provide a client.");
  return instance;
}

export function resetInstanceForTests() {
  // Useful helper for unit tests
  try {
    instance && instance.shutdown();
  } catch {}
  instance = null;
}
