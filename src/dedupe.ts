/** @format */

export type StorageAdapter = {
  get(key: string): string | null | Promise<string | null>;
  set(key: string, value: string): void | Promise<void>;
  remove?(key: string): void | Promise<void>;
};

export const PREFIX = "mx:dedupe:";

function isBrowserStorageAvailable(storage: Storage | undefined) {
  if (!storage) return false;
  try {
    const k = "mx_dedupe_test";
    storage.setItem(k, "1");
    storage.removeItem(k);
    return true;
  } catch {
    return false;
  }
}

export const LocalStorageAdapter: StorageAdapter = {
  get(key: string) {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  set(key: string, value: string) {
    try {
      localStorage.setItem(key, value);
    } catch {}
  },
  remove(key: string) {
    try {
      localStorage.removeItem(key);
    } catch {}
  },
};

export const SessionStorageAdapter: StorageAdapter = {
  get(key: string) {
    try {
      return sessionStorage.getItem(key);
    } catch {
      return null;
    }
  },
  set(key: string, value: string) {
    try {
      sessionStorage.setItem(key, value);
    } catch {}
  },
  remove(key: string) {
    try {
      sessionStorage.removeItem(key);
    } catch {}
  },
};

export const NoopAdapter: StorageAdapter = {
  get() {
    return null;
  },
  set() {
    return;
  },
  remove() {
    return;
  },
};

export function makeKey(prefix: string, key: string) {
  return `${prefix}${key}`;
}

export async function shouldSendOnce(adapter: StorageAdapter, key: string, ttlMs: number) {
  // adapter.get/set can be sync or async
  try {
    const raw = await Promise.resolve(adapter.get(key));
    if (!raw) return true;

    // stored value expected to be JSON: { expiry: number }
    try {
      const obj = JSON.parse(raw);
      if (!obj || !obj.expiry) return true;
      if (Date.now() >= Number(obj.expiry)) return true;
      return false;
    } catch {
      // malformed -> allow
      return true;
    }
  } catch {
    // if adapter throws, treat as unavailable and allow send
    return true;
  }
}

export async function markSent(adapter: StorageAdapter, key: string, ttlMs: number) {
  try {
    const payload = JSON.stringify({ expiry: Date.now() + ttlMs });
    await Promise.resolve(adapter.set(key, payload));
  } catch {}
}
