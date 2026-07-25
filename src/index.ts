/** @format
 * MetrioxTG Web SDK (Telegram WebApp) - TypeScript
 */

// =========================
// Types
// =========================
export type AutoOptionObject = { page?: boolean; nav?: boolean; clicks?: boolean; forms?: boolean; errors?: boolean };
export type AutoOptions = boolean | AutoOptionObject;

export interface Config {
  projectId: string;
  botId: string;
  // auth may be an object (sync) or a function that returns either an object or a Promise
  auth?: { initData?: string } | (() => { initData?: string } | Promise<{ initData?: string }>);
  flushMs?: number;
  maxBatch?: number;
  maxQueue?: number;
  retryBaseMs?: number;
  retryCount?: number;
  auto?: AutoOptions;
}

export interface MetrioxClient {
  track(name: string, props?: Record<string, any>, options?: { text?: string }): void;
  page(name: string, props?: Record<string, any>): void;
  interaction(name: string, props?: Record<string, any>): void;
  flush(): Promise<void>;
  shutdown(): void;
}

// =========================
// Constants / defaults
// =========================
const ENDPOINT = "https://ingest.metriox.com/tg/webapp"; // hard-coded
const SDK_NAME = "metriox-tg-webapp";
const SDK_VERSION = "1.0.0"; // keep in sync with package.json if you want

const DEFAULTS = {
  flushMs: 5000,
  maxBatch: 20,
  maxQueue: 500,
  retryBaseMs: 400,
  retryCount: 2,
  auto: false,
};

// =========================
// Helpers
// =========================
function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function uuid() {
  // Prefer native randomUUID when available
  const rnd = globalThis.crypto as any;
  if (rnd?.randomUUID) return rnd.randomUUID();

  // Fallback to a simple RFC4122 version 4 style generator
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (ch) => {
    let r: number;
    if (rnd?.getRandomValues) {
      r = rnd.getRandomValues(new Uint8Array(1))[0] & 15;
    } else {
      r = Math.floor(Math.random() * 16);
    }
    const v = ch === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/**
 * Longest string property value the ingest accepts, in characters. Mirrors the server's
 * `PropsPolicy.MaxStringValueLen`; the server truncates past it and reports a `prop_value_truncated`
 * warning, so clamping here only avoids sending bytes that would be dropped anyway.
 *
 * This was 2048 — half the server's limit, which made the SDK stricter than the contract it targets
 * for no reason (flagged in the platform's own ingest-contract audit). It mattered for the compact
 * `$tg` blobs: a fully formatted message can carry 64 entity spans, and those cross 2048 while
 * staying well inside 4096. A clamped blob is invalid JSON, so the reader degrades to "no
 * formatting" — silently.
 */
export const MAX_PROP_STRING_LEN = 4096;

function clampString(value: unknown, maxLen: number = MAX_PROP_STRING_LEN) {
  if (typeof value !== "string") return value;
  return value.length <= maxLen ? value : value.slice(0, maxLen);
}

export function splitProps(props?: Record<string, any>) {
  const s: Record<string, any> = {};
  const l: Record<string, number> = {};
  const b: Record<string, boolean> = {};
  if (!props) return {};

  for (const [k, v] of Object.entries(props)) {
    if (v == null) continue;

    if (typeof v === "string") {
      s[k] = clampString(v);
      continue;
    }
    if (typeof v === "boolean") {
      b[k] = v;
      continue;
    }
    if (typeof v === "number") {
      if (Number.isInteger(v) && Number.isSafeInteger(v)) l[k] = v as number;
      else s[k] = clampString(String(v));
      continue;
    }

    try {
      s[k] = clampString(JSON.stringify(v));
    } catch {
      s[k] = clampString(String(v));
    }
  }

  const out: Record<string, any> = {};
  if (Object.keys(s).length) out.PropsString = s;
  if (Object.keys(l).length) out.PropsLong = l;
  if (Object.keys(b).length) out.PropsBool = b;
  return out;
}

export function mergeAuto(auto: AutoOptions) {
  if (auto === true) return { page: true, nav: true, clicks: true, forms: true, errors: true };
  if (!auto) return { page: false, nav: false, clicks: false, forms: false, errors: false };
  return { page: !!auto.page, nav: !!auto.nav, clicks: !!auto.clicks, forms: !!auto.forms, errors: !!auto.errors };
}

// =========================
// Telegram inline keyboard
// =========================
export interface TgInlineButton {
  text: string;
  callback_data?: string;
  url?: string;
}

export interface TgInlineKeyboardMarkup {
  inline_keyboard: TgInlineButton[][];
}

/**
 * Serializes a Telegram Bot API inline keyboard into the compact JSON string Metriox stores at
 * `$tg.inline_keyboard`, so the per-user conversation view can show which buttons a message offered
 * and resolve a pressed callback back to its button label.
 *
 * A callback button keeps its payload (`callback_data`), a url button keeps its target (`url`); both
 * keep their label (`text`). Other button kinds carry neither, so they are skipped. Returns `null` when
 * there is nothing to record — omit the property in that case.
 *
 * The keys are the Bot API's own `InlineKeyboardButton` field names, so the stored value reads as
 * itself. They were single letters (`t`/`d`/`u`) before 2026-07-26 — Metriox still accepts that spelling
 * on read, so an older SDK build keeps working, but new sends should use this one.
 *
 * Attach the result as `tg.inline_keyboard` on a *platform-origin* Telegram message event, alongside
 * `tg.from_is_bot: true` (e.g. a Node bot reporting its own send). Note the WebApp `track()` path
 * emits custom-origin events, which the ingest does not promote into the reserved `$tg` section.
 */
export function serializeInlineKeyboard(markup?: TgInlineKeyboardMarkup | null): string | null {
  const rows = markup?.inline_keyboard;
  if (!Array.isArray(rows)) return null;

  const out: Array<{ text: string; callback_data?: string; url?: string }> = [];
  for (const row of rows) {
    if (!Array.isArray(row)) continue;
    for (const b of row) {
      if (!b) continue;
      if (b.callback_data) out.push({ text: b.text, callback_data: b.callback_data });
      else if (b.url) out.push({ text: b.text, url: b.url });
      // other button kinds carry no callback_data or url to surface — skipped
    }
  }

  return out.length ? JSON.stringify(out) : null;
}

/** One formatting span of a Telegram message, as the Bot API reports it. */
export interface TgMessageEntity {
  /** Bot-API token: `bold`, `italic`, `text_link`, `code`, `spoiler`, … */
  type: string;
  /** Start index in UTF-16 code units — the unit both Telegram and JavaScript use. */
  offset: number;
  length: number;
  /** Target for `text_link` spans. */
  url?: string;
}

/** Matches the backend cap: past a few dozen spans a message renders the same but the row keeps growing. */
export const MAX_MESSAGE_ENTITIES = 64;

/**
 * Serializes a message's formatting spans into the compact JSON string Metriox stores at
 * `$tg.entities`, so bold text, code and inline links render in the conversation view.
 *
 * Telegram never sends formatted text — it sends plain text plus these offset/length spans — so
 * without them a message's formatting cannot be recovered at all, only counted. Attach the result as
 * `tg.entities` on a *platform-origin* Telegram message event, the same way as
 * {@link serializeInlineKeyboard}.
 *
 * Keys are the Bot API's own `MessageEntity` field names (`type`/`offset`/`length`/`url`); they were
 * single letters (`t`/`o`/`l`/`u`) before 2026-07-26, which Metriox still reads.
 *
 * Returns `null` when there is nothing to record, so an unformatted message carries no property.
 */
export function serializeMessageEntities(entities?: TgMessageEntity[] | null): string | null {
  if (!Array.isArray(entities)) return null;

  const out: Array<{ type: string; offset: number; length: number; url?: string }> = [];
  for (const e of entities) {
    if (!e || !e.type || !(e.length > 0) || !(e.offset >= 0)) continue;
    if (out.length === MAX_MESSAGE_ENTITIES) break;

    out.push(
      e.url
        ? { type: e.type, offset: e.offset, length: e.length, url: e.url }
        : { type: e.type, offset: e.offset, length: e.length },
    );
  }

  return out.length ? JSON.stringify(out) : null;
}

// =========================
// Cross-producer event identity
// =========================

/**
 * Keys that identify a Telegram event independently of who captured it. A MIRROR of the backend's
 * `TelegramEventKeys`; the strings are a published contract — both sides must agree exactly or the
 * same event captured twice becomes two rows.
 *
 * Note what is absent: `update_id`, and any bot identifier. `update_id` exists only in the Bot-API
 * getUpdates/webhook stream — Metriox's MTProto worker has no equivalent, so a key built from it can
 * never match. A bot identifier cannot appear because the server keys on its own internal bot id,
 * which no SDK knows; uniqueness is already scoped per bot server-side.
 *
 * Chat ids must be the Bot-API convention (`-100…` for channels/supergroups, negative for basic
 * groups), which is what the Bot API already gives you — pass them through unchanged.
 */
export const tgEventKeys = {
  message: (chatId: number | string, messageId: number | string) => `tg:msg:${chatId}:${messageId}`,
  messageEdit: (chatId: number | string, messageId: number | string, editUnixSeconds: number) =>
    `tg:edit:${chatId}:${messageId}:${editUnixSeconds}`,
  businessMessage: (chatId: number | string, messageId: number | string) => `tg:bizmsg:${chatId}:${messageId}`,
  callbackQuery: (queryId: string) => `tg:cbq:${queryId}`,
  inlineQuery: (queryId: string) => `tg:iq:${queryId}`,
  chosenInlineResult: (userId: number | string, resultId: string) => `tg:isend:${userId}:${resultId}`,
  preCheckoutQuery: (queryId: string) => `tg:pcq:${queryId}`,
  shippingQuery: (queryId: string) => `tg:sq:${queryId}`,
  reactions: (chatId: number | string, messageId: number | string) => `tg:react:${chatId}:${messageId}`,
  pollVote: (chatId: number | string, pollId: string) => `tg:pollvote:${chatId}:${pollId}`,
} as const;

// Namespace bytes of the backend's DeterministicUuid. Every byte is repeated within its field, so
// .NET's mixed-endian Guid.ToByteArray() layout and the RFC order coincide here — which is the only
// reason this is reproducible outside .NET without emulating those quirks.
const UUID5_NAMESPACE = new Uint8Array([
  0x11, 0x11, 0x11, 0x11, 0x22, 0x22, 0x33, 0x33, 0x44, 0x44, 0x55, 0x55, 0x55, 0x55, 0x55, 0x55,
]);

const hex = (b: number) => b.toString(16).padStart(2, "0");

/**
 * The event id for a key from {@link tgEventKeys}: UUID v5 (SHA-1) over the shared namespace, formatted
 * the way .NET's `Guid` prints the same bytes.
 *
 * That last part is the subtle bit. `new Guid(byte[])` reads the first three groups as little-endian,
 * so its string form reverses bytes 0-3, 4-5 and 6-7 relative to the hash. Emitting RFC-ordered hex
 * here would parse server-side into a *different* Guid and silently never dedup, so the byte order is
 * mirrored deliberately rather than left "standard".
 *
 * Async because it uses WebCrypto, which is the only SHA-1 available in both browsers and Node without
 * a dependency. Requires a secure context in browsers (Telegram WebApps always are).
 */
export async function telegramEventId(key: string): Promise<string> {
  const value = new TextEncoder().encode(key);

  const data = new Uint8Array(UUID5_NAMESPACE.length + value.length);
  data.set(UUID5_NAMESPACE, 0);
  data.set(value, UUID5_NAMESPACE.length);

  const digest = new Uint8Array(await crypto.subtle.digest("SHA-1", data));
  const b = digest.slice(0, 16);

  b[6] = (b[6] & 0x0f) | 0x50; // version 5
  b[8] = (b[8] & 0x3f) | 0x80; // variant

  const g1 = [b[3], b[2], b[1], b[0]].map(hex).join("");
  const g2 = [b[5], b[4]].map(hex).join("");
  const g3 = [b[7], b[6]].map(hex).join("");
  const g4 = [b[8], b[9]].map(hex).join("");
  const g5 = Array.from(b.slice(10, 16)).map(hex).join("");

  return `${g1}-${g2}-${g3}-${g4}-${g5}`;
}

// =========================
// Transport
// =========================
function isSameOrigin(url: string) {
  try {
    return new URL(url, location.href).origin === location.origin;
  } catch {
    return false;
  }
}

async function sendRequest(body: any, retryCount: number, retryBaseMs: number) {
  // Only beacon on same-origin to avoid CORS credential quirks
  if (isSameOrigin(ENDPOINT)) {
    try {
      if (navigator.sendBeacon) {
        const blob = new Blob([JSON.stringify(body)], { type: "application/json" });
        const ok = navigator.sendBeacon(ENDPOINT, blob);
        if (ok) return true;
      }
    } catch {}
  }

  for (let attempt = 0; attempt <= retryCount; attempt++) {
    try {
      const res = await fetch(ENDPOINT, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
        keepalive: true,
        credentials: "omit",
      });
      if (res.ok) return true;
    } catch {}
    if (attempt < retryCount) await sleep(retryBaseMs * Math.pow(2, attempt));
  }
  return false;
}

// =========================
// Auto instrumentation
// =========================
function attachAuto(client: MetrioxClient, autoOptions: AutoOptions) {
  const enabled = mergeAuto(autoOptions);
  const cleanups: Array<() => void> = [];

  if (enabled.page) {
    client.page("page_view", { path: location.pathname + location.search, title: document.title });
  }

  if (enabled.nav) {
    const origPushState = history.pushState;

    function trackNav() {
      client.page("navigation", { path: location.pathname + location.search, title: document.title });
    }

    history.pushState = function () {
      // @ts-ignore - forward args
      origPushState.apply(history, arguments as any);
      trackNav();
    } as any;

    const onPop = () => trackNav();
    window.addEventListener("popstate", onPop);

    cleanups.push(() => {
      history.pushState = origPushState;
      window.removeEventListener("popstate", onPop);
    });
  }

  if (enabled.clicks) {
    const onClick = (e: Event) => {
      const el = (e.target as Element | null)?.closest?.("[data-mx]");
      if (!el) return;
      client.interaction("click", { mx: el.getAttribute("data-mx") || "", tag: el.tagName, id: el.id || "" });
    };

    document.addEventListener("click", onClick, true);
    cleanups.push(() => document.removeEventListener("click", onClick, true));
  }

  if (enabled.forms) {
    const onSubmit = (e: Event) => {
      const form = e.target as HTMLFormElement;
      if (!(form instanceof HTMLFormElement)) return;
      client.interaction("form_submit", { formId: form.id || "", method: form.method || "", action: form.action || "" });
    };

    document.addEventListener("submit", onSubmit, true);
    cleanups.push(() => document.removeEventListener("submit", onSubmit, true));
  }

  if (enabled.errors) {
    const onError = (e: ErrorEvent) => {
      (client as any).track("error_unhandled", { message: e.message || "", source: e.filename || "", line: e.lineno || 0, col: e.colno || 0 });
    };

    const onRejection = (e: PromiseRejectionEvent) => {
      (client as any).track("promise_rejection", { message: String((e as any).reason?.message || (e as any).reason || "") });
    };

    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection as EventListener);

    cleanups.push(() => {
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onRejection as EventListener);
    });
  }

  return function cleanup() {
    for (const fn of cleanups) {
      try {
        fn();
      } catch {}
    }
  };
}

// =========================
// Client init
// =========================
export function init(config: Config): MetrioxClient {
  if (!config?.projectId || !config?.botId) throw new Error("projectId and botId required");

  const opts = {
    flushMs: config.flushMs ?? DEFAULTS.flushMs,
    maxBatch: config.maxBatch ?? DEFAULTS.maxBatch,
    maxQueue: config.maxQueue ?? DEFAULTS.maxQueue,
    retryBaseMs: config.retryBaseMs ?? DEFAULTS.retryBaseMs,
    retryCount: config.retryCount ?? DEFAULTS.retryCount,
    auto: config.auto ?? DEFAULTS.auto,
  };

  const state = {
    projectId: config.projectId,
    botId: config.botId,
    auth: config.auth,
    queue: [] as any[],
    timer: null as any,
    flushing: false,
    alive: true,
    cleanupFns: [] as Array<() => void>,
  };

  function baseProps(extra?: Record<string, any>) {
    const p = Object.assign({}, extra);
    (p as any).sdk = SDK_NAME;
    (p as any).sdk_version = SDK_VERSION;
    return p;
  }

  function scheduleFlush() {
    if (!state.alive || state.timer) return;
    state.timer = setTimeout(() => {
      state.timer = null;
      flush();
    }, opts.flushMs);
  }

  function enqueue(evt: any) {
    if (!state.alive) return;

    if (state.queue.length >= opts.maxQueue) {
      state.queue.splice(0, state.queue.length - opts.maxQueue + 1);
    }

    state.queue.push(evt);

    if (state.queue.length >= opts.maxBatch) flush();
    else scheduleFlush();
  }

  function pushEvent(eventType: string, eventName: string, props?: Record<string, any>, text?: string) {
    enqueue({
      EventId: uuid(),
      EventType: String(eventType),
      EventName: String(eventName),
      EventDate: new Date().toISOString(),
      Text: text,
      ...splitProps(baseProps(props)),
    });
  }

  async function resolveInitData() {
    if (typeof state.auth === "function") {
      const v = await (state.auth as () => Promise<any>)();
      return v?.initData ?? "";
    }
    if (state.auth && typeof state.auth === "object") {
      return (state.auth as any).initData ?? "";
    }
    return (globalThis as any).Telegram?.WebApp?.initData ?? "";
  }

  async function flush() {
    if (!state.alive || state.flushing || !state.queue.length) return;
    state.flushing = true;

    try {
      const events = state.queue.splice(0, opts.maxBatch);
      const initData = await resolveInitData();

      const body = {
        ProjectId: state.projectId,
        BotId: state.botId,
        Auth: {
          InitData: initData || "",
        },
        Events: events,
      };

      const ok = await sendRequest(body, opts.retryCount, opts.retryBaseMs);

      if (!ok) {
        state.queue = events.concat(state.queue);
        scheduleFlush();
      } else if (state.queue.length) {
        scheduleFlush();
      }
    } finally {
      state.flushing = false;
    }
  }

  const client: MetrioxClient = {
    track(name, props, options) {
      pushEvent("custom", name, props, options?.text);
    },
    page(name, props) {
      pushEvent("page", name, props);
    },
    interaction(name, props) {
      pushEvent("interaction", name, props);
    },
    flush,
    shutdown() {
      state.alive = false;
      if (state.timer) clearTimeout(state.timer);
      state.timer = null;

      for (const fn of state.cleanupFns) {
        try {
          fn();
        } catch {}
      }
      state.cleanupFns = [];
    },
  };

  if (opts.auto) {
    state.cleanupFns.push(attachAuto(client, opts.auto));
  }

  const onVis = () => {
    if (document.visibilityState === "hidden") client.flush();
  };
  document.addEventListener("visibilitychange", onVis);
  state.cleanupFns.push(() => document.removeEventListener("visibilitychange", onVis));

  return client;
}

// expose global for legacy consumers
(globalThis as any).MetrioxTG = {
  init,
  serializeInlineKeyboard,
  serializeMessageEntities,
  telegramEventId,
  tgEventKeys,
};
