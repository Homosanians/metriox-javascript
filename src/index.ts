/** @format
 * MetrioxTG Web SDK (Telegram WebApp) - TypeScript
 */

// =========================
// Types
// =========================
export type AutoOptionObject = {
  page?: boolean;
  nav?: boolean;
  clicks?: boolean;
  forms?: boolean;
  errors?: boolean;
  /** Telegram WebApp lifecycle events (buttons, invoices, theme/viewport, activation). */
  tg?: boolean;
};
export type AutoOptions = boolean | AutoOptionObject;

/**
 * The canonical `$event.type` vocabulary, mirroring the server's `EventVocabulary.Type`. Anything
 * outside this set is coerced to `platform` by the ingest gate, which also raises an
 * `event_type_unknown` warning on every event that carries it — this SDK used to ship `"custom"`
 * and `"page"`, and is named in the platform's own contract audit (A7) for exactly that.
 */
export type EventType = "message" | "interaction" | "payment" | "membership" | "business" | "poll" | "reaction" | "boost" | "platform";

export const EVENT_TYPES: readonly EventType[] = [
  "message",
  "interaction",
  "payment",
  "membership",
  "business",
  "poll",
  "reaction",
  "boost",
  "platform",
];

/** Coerces a client-supplied type the same way the server does, so nothing changes on arrival. */
export function coerceEventType(type?: string): EventType {
  return (EVENT_TYPES as readonly string[]).includes(type as string) ? (type as EventType) : "platform";
}

export interface Config {
  /**
   * Optional, and ignored by the ingest: the server resolves the owning project from `botId` and
   * deliberately refuses to trust a caller-supplied project id (cross-project write / billing
   * bypass). Kept so existing call sites keep compiling.
   *
   * @deprecated Has no effect on where events land.
   */
  projectId?: string;
  botId: string;
  // auth may be an object (sync) or a function that returns either an object or a Promise
  auth?: { initData?: string } | (() => { initData?: string } | Promise<{ initData?: string }>);
  flushMs?: number;
  maxBatch?: number;
  maxQueue?: number;
  retryBaseMs?: number;
  retryCount?: number;
  auto?: AutoOptions;
  /**
   * Attach the WebApp/browser context block (platform, client version, viewport, locale, session)
   * to every event. On by default — without it an event cannot be segmented by device or client.
   *
   * Nothing here duplicates initData: the user, chat type, chat instance and start param are
   * derived server-side from the signed string, so sending them again would only cost bytes.
   */
  context?: boolean;
}

export interface MetrioxClient {
  /**
   * Records a custom business event. `type` is the canonical `$event.type` category — omit it and
   * the event is recorded as `platform`, which is also what the server coerces an unknown value to.
   */
  track(name: string, props?: Record<string, any>, options?: { text?: string; type?: EventType }): void;
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

// Must track package.json. The server promotes this into $source.sdk_version precisely so a bad
// rollout is diagnosable from the data, which only works if the number moves when the wire does.
const SDK_VERSION = "0.2.0";

const DEFAULTS = {
  flushMs: 5000,
  maxBatch: 20,
  maxQueue: 500,
  retryBaseMs: 400,
  retryCount: 2,
  auto: false,
  context: true,
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
  if (auto === true) return { page: true, nav: true, clicks: true, forms: true, errors: true, tg: true };
  if (!auto) return { page: false, nav: false, clicks: false, forms: false, errors: false, tg: false };
  return {
    page: !!auto.page,
    nav: !!auto.nav,
    clicks: !!auto.clicks,
    forms: !!auto.forms,
    errors: !!auto.errors,
    tg: !!auto.tg,
  };
}

// =========================
// WebApp / browser context
// =========================

/** The Telegram bridge, or undefined — the SDK also loads in a plain browser and must not throw. */
function tgWebApp(): any {
  return (globalThis as any).Telegram?.WebApp;
}

function safe<T>(read: () => T): T | undefined {
  try {
    return read();
  } catch {
    return undefined;
  }
}

/**
 * Context that cannot change during a launch: which client, which device, which session.
 *
 * Key naming here is load-bearing. Since the ingest started stamping `EventOrigin = "platform"` on
 * this endpoint (audit A3) the promote-shim is *live* on WebApp events — a property literally named
 * `tg.<field>` gets lifted into the reserved `$tg` section whenever `<field>` is canonical. That is
 * a trap for exactly this data: `$tg.chat_type` already means *the message chat's* type, so a
 * WebApp key of that name would silently conflate two different fields. The server's own registry
 * keeps them apart as `webapp_chat_type`, and nothing below uses a `tg.` prefix for the same
 * reason — `tg_` is an ordinary custom key and stays at the top level.
 *
 * Every number is an integer on purpose. The WebApp wire contract carries string, long and bool
 * buckets only (`WebAppEvent` has no `PropsFloat`, and the mapper hardcodes it to null), so a
 * fractional value would be filed as a string and stop being aggregatable. Device pixel ratio is
 * therefore scaled by 100 rather than rounded away — 1.5 and 2.0 are different devices.
 */
export function collectStaticContext(sessionId: string): Record<string, any> {
  const wa = tgWebApp();
  const nav: any = (globalThis as any).navigator;
  const scr: any = (globalThis as any).screen;

  const ctx: Record<string, any> = { session_id: sessionId };

  if (wa) {
    ctx.tg_platform = wa.platform;
    ctx.tg_client_version = wa.version;
    ctx.tg_color_scheme = wa.colorScheme;
  }

  if (nav) ctx.language = nav.language;
  ctx.timezone = safe(() => Intl.DateTimeFormat().resolvedOptions().timeZone);
  ctx.referrer = safe(() => document.referrer) || undefined;

  if (scr) {
    ctx.screen_w = scr.width;
    ctx.screen_h = scr.height;
  }

  const dpr = safe(() => (globalThis as any).devicePixelRatio);
  if (typeof dpr === "number" && dpr > 0) ctx.dpr_x100 = Math.round(dpr * 100);

  return ctx;
}

/**
 * Context that moves while the app is open. Read at enqueue time rather than at flush time, so a
 * batched event reports the viewport it actually happened in.
 */
export function collectDynamicContext(): Record<string, any> {
  const wa = tgWebApp();
  const ctx: Record<string, any> = {};

  ctx.path = safe(() => location.pathname + location.search);

  const w = safe(() => (globalThis as any).innerWidth);
  const h = safe(() => (globalThis as any).innerHeight);
  if (typeof w === "number") ctx.viewport_w = Math.round(w);
  if (typeof h === "number") ctx.viewport_h = Math.round(h);

  if (wa) {
    if (typeof wa.viewportHeight === "number") ctx.tg_viewport_h = Math.round(wa.viewportHeight);
    if (typeof wa.isExpanded === "boolean") ctx.tg_is_expanded = wa.isExpanded;
    // Mini Apps 8.0+; absent on older clients, and absent is the honest answer there.
    if (typeof wa.isFullscreen === "boolean") ctx.tg_is_fullscreen = wa.isFullscreen;
    if (typeof wa.isActive === "boolean") ctx.tg_is_active = wa.isActive;
  }

  return ctx;
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
 * Attach the result as `tg.inline_keyboard` on a Telegram message event, alongside
 * `tg.from_is_bot: true` (e.g. a Node bot reporting its own send).
 *
 * This works from a WebApp too. It did not use to: the ingest promotes reserved `tg.*` keys into
 * `$tg` only for platform-origin events, and the WebApp mapper wrote its own `"webapp"` literal
 * that nothing downstream recognised, so these events were classified as custom and never promoted
 * (audit A3). The mapper now stamps the shared `"platform"` literal on every WebApp event, so a
 * `tg.inline_keyboard` sent from here lands in `$tg` like any other producer's.
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
 * `tg.entities` on a Telegram message event, the same way as {@link serializeInlineKeyboard} — and,
 * as noted there, WebApp events reach `$tg` too now.
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

/** What the caller should do with a batch after an attempt. */
export type SendOutcome = "sent" | "retry" | "drop";

/**
 * Classifies an HTTP status the way the ingest means it.
 *
 * The server returns 4xx specifically so a permanently bad batch stops being retried — its own
 * comment says so where it rejects every event in a request (audit A2/A8). This SDK ignored that
 * and re-queued on *any* non-2xx, so an unauthorized or over-quota batch was re-sent until it aged
 * out of the queue, taking newer events with it. 408 and 429 are the two 4xx that genuinely mean
 * "later", so they keep their retry.
 */
export function classifyStatus(status: number): SendOutcome {
  if (status >= 200 && status < 300) return "sent";
  if (status === 408 || status === 429) return "retry";
  if (status >= 400 && status < 500) return "drop";
  return "retry";
}

async function sendRequest(body: any, retryCount: number, retryBaseMs: number): Promise<SendOutcome> {
  // Only beacon on same-origin to avoid CORS credential quirks
  if (isSameOrigin(ENDPOINT)) {
    try {
      if (navigator.sendBeacon) {
        const blob = new Blob([JSON.stringify(body)], { type: "application/json" });
        const ok = navigator.sendBeacon(ENDPOINT, blob);
        if (ok) return "sent";
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

      const outcome = classifyStatus(res.status);
      if (outcome !== "retry") return outcome;
    } catch {
      // Network-level failure: no verdict from the server, so it is worth another attempt.
    }
    if (attempt < retryCount) await sleep(retryBaseMs * Math.pow(2, attempt));
  }
  return "retry";
}

// =========================
// Auto instrumentation
// =========================

/**
 * The Telegram WebApp lifecycle events worth recording, the canonical category each belongs to, and
 * the handler-argument fields kept from it.
 *
 * `keep` is an allow-list rather than a filter because two of these events hand the app content the
 * user did not choose to send us: `qrTextReceived` and `clipboardTextReceived` both carry a `data`
 * field holding scanned or pasted text. That the scan happened is analytics; its contents are the
 * user's. They are recorded with no payload at all.
 *
 * Unknown events are simply absent on older clients — `onEvent` accepts the subscription and never
 * fires, which is the correct outcome and needs no version gate.
 */
const TG_LIFECYCLE: Array<{ event: string; name: string; type: EventType; keep?: string[] }> = [
  { event: "mainButtonClicked", name: "tg_main_button_clicked", type: "interaction" },
  { event: "secondaryButtonClicked", name: "tg_secondary_button_clicked", type: "interaction" },
  { event: "backButtonClicked", name: "tg_back_button_clicked", type: "interaction" },
  { event: "settingsButtonClicked", name: "tg_settings_button_clicked", type: "interaction" },
  { event: "popupClosed", name: "tg_popup_closed", type: "interaction", keep: ["button_id"] },
  { event: "writeAccessRequested", name: "tg_write_access_requested", type: "interaction", keep: ["status"] },
  { event: "contactRequested", name: "tg_contact_requested", type: "interaction", keep: ["status"] },
  { event: "qrTextReceived", name: "tg_qr_text_received", type: "interaction" },
  { event: "clipboardTextReceived", name: "tg_clipboard_text_received", type: "interaction" },
  { event: "invoiceClosed", name: "tg_invoice_closed", type: "payment", keep: ["status"] },
  { event: "themeChanged", name: "tg_theme_changed", type: "platform" },
  { event: "viewportChanged", name: "tg_viewport_changed", type: "platform" },
  { event: "fullscreenChanged", name: "tg_fullscreen_changed", type: "platform" },
  { event: "fullscreenFailed", name: "tg_fullscreen_failed", type: "platform", keep: ["error"] },
  { event: "activated", name: "tg_activated", type: "platform" },
  { event: "deactivated", name: "tg_deactivated", type: "platform" },
];

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

  if (enabled.tg) {
    const wa = tgWebApp();

    if (typeof wa?.onEvent === "function") {
      for (const spec of TG_LIFECYCLE) {
        const handler = (arg?: any) => {
          // The viewport reports every intermediate frame of an animated resize. Only the settled
          // value describes a state the user was actually in; the rest is one gesture billed many
          // times over.
          if (spec.event === "viewportChanged" && arg && arg.isStateStable === false) return;

          const props: Record<string, any> = {};
          for (const key of spec.keep || []) {
            const value = arg?.[key];
            if (value != null) props[key] = value;
          }

          client.track(spec.name, props, { type: spec.type });
        };

        try {
          wa.onEvent(spec.event, handler);
        } catch {
          continue;
        }

        cleanups.push(() => {
          try {
            wa.offEvent?.(spec.event, handler);
          } catch {}
        });
      }
    }
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
  // projectId is not checked: the ingest derives the project from the bot and refuses to trust a
  // caller-supplied one, so demanding it here only blocked correct integrations.
  if (!config?.botId) throw new Error("botId required");

  const opts = {
    flushMs: config.flushMs ?? DEFAULTS.flushMs,
    maxBatch: config.maxBatch ?? DEFAULTS.maxBatch,
    maxQueue: config.maxQueue ?? DEFAULTS.maxQueue,
    retryBaseMs: config.retryBaseMs ?? DEFAULTS.retryBaseMs,
    retryCount: config.retryCount ?? DEFAULTS.retryCount,
    auto: config.auto ?? DEFAULTS.auto,
    context: config.context ?? DEFAULTS.context,
  };

  const state = {
    botId: config.botId,
    auth: config.auth,
    queue: [] as any[],
    timer: null as any,
    flushing: false,
    alive: true,
    cleanupFns: [] as Array<() => void>,
    // Identifies this launch. The server derives a session id too, but per user per *calendar day*
    // — which cannot separate two openings of the app, and that is the question a Mini App is
    // usually asked.
    sessionId: uuid(),
    seq: 0,
  };

  const staticContext = opts.context ? collectStaticContext(state.sessionId) : null;

  function baseProps(extra?: Record<string, any>) {
    const p: Record<string, any> = staticContext
      ? Object.assign({}, staticContext, collectDynamicContext(), extra)
      : Object.assign({}, extra);

    if (staticContext) p.seq = state.seq++;

    p.sdk = SDK_NAME;
    p.sdk_version = SDK_VERSION;
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

  function pushEvent(eventType: EventType, eventName: string, props?: Record<string, any>, text?: string) {
    enqueue({
      EventId: uuid(),
      EventType: eventType,
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

      // No ProjectId: the endpoint has no such field and resolves the project from the bot.
      const body = {
        BotId: state.botId,
        Auth: {
          InitData: initData || "",
        },
        Events: events,
      };

      const outcome = await sendRequest(body, opts.retryCount, opts.retryBaseMs);

      // "drop" means the server gave a verdict this batch can never pass — re-queueing it would
      // block every later event behind a batch that will fail identically forever.
      if (outcome === "retry") {
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
    // "custom" and "page" were not $event.type values — the server coerced both to "platform" and
    // attached an event_type_unknown warning to every single event. Send what it stores.
    track(name, props, options) {
      pushEvent(coerceEventType(options?.type), name, props, options?.text);
    },
    page(name, props) {
      pushEvent("platform", name, props);
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

  // visibilitychange alone loses the last batch on the platforms that matter most here: a Mini App
  // closed from the Telegram UI can be torn down without ever reporting hidden, and iOS WebViews
  // are the usual offender. pagehide fires in that path.
  const onPageHide = () => client.flush();
  window.addEventListener("pagehide", onPageHide);
  state.cleanupFns.push(() => window.removeEventListener("pagehide", onPageHide));

  return client;
}

// expose global for legacy consumers
(globalThis as any).MetrioxTG = {
  init,
  serializeInlineKeyboard,
  serializeMessageEntities,
  telegramEventId,
  tgEventKeys,
  EVENT_TYPES,
};
