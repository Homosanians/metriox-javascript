/** @format
 * MetrioxTG Web SDK (Telegram WebApp)
 * - Hard-coded endpoint
 * - Small public API: init() -> { track, page, interaction, flush, shutdown }
 * - Batching + simple retry
 * - Optional auto instrumentation with proper cleanup
 * - Safe click tracking via [data-mx]
 */

(function (global) {
  "use strict";

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
  function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }

  function uuid() {
    return crypto?.randomUUID?.() ?? ([1e7] + -1e3 + -4e3 + -8e3 + -1e11).replace(/[018]/g, (c) => (c ^ (crypto.getRandomValues(new Uint8Array(1))[0] & (15 >> (c / 4)))).toString(16));
  }

  function clampString(value, maxLen) {
    if (typeof value !== "string") return value;
    return value.length <= maxLen ? value : value.slice(0, maxLen);
  }

  function splitProps(props) {
    const s = {};
    const l = {};
    const b = {};
    if (!props) return {};

    for (const [k, v] of Object.entries(props)) {
      if (v == null) continue;

      if (typeof v === "string") {
        s[k] = clampString(v, 2048);
        continue;
      }
      if (typeof v === "boolean") {
        b[k] = v;
        continue;
      }
      if (typeof v === "number") {
        if (Number.isInteger(v) && Number.isSafeInteger(v)) l[k] = v;
        else s[k] = clampString(String(v), 2048);
        continue;
      }

      try {
        s[k] = clampString(JSON.stringify(v), 2048);
      } catch {
        s[k] = clampString(String(v), 2048);
      }
    }

    const out = {};
    if (Object.keys(s).length) out.PropsString = s;
    if (Object.keys(l).length) out.PropsLong = l;
    if (Object.keys(b).length) out.PropsBool = b;
    return out;
  }

  function mergeAuto(auto) {
    if (auto === true) return { page: true, nav: true, clicks: true, forms: true, errors: true };
    if (!auto) return { page: false, nav: false, clicks: false, forms: false, errors: false };
    return { page: !!auto.page, nav: !!auto.nav, clicks: !!auto.clicks, forms: !!auto.forms, errors: !!auto.errors };
  }

  // =========================
  // Transport
  // =========================
  function isSameOrigin(url) {
    try {
      return new URL(url, location.href).origin === location.origin;
    } catch {
      return false;
    }
  }

  async function sendRequest(body, retryCount, retryBaseMs) {
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
  function attachAuto(client, autoOptions) {
    const enabled = mergeAuto(autoOptions);
    const cleanups = [];

    if (enabled.page) {
      client.page("page_view", { path: location.pathname + location.search, title: document.title });
    }

    if (enabled.nav) {
      const origPushState = history.pushState;

      function trackNav() {
        client.page("navigation", { path: location.pathname + location.search, title: document.title });
      }

      history.pushState = function () {
        origPushState.apply(history, arguments);
        trackNav();
      };

      const onPop = () => trackNav();
      window.addEventListener("popstate", onPop);

      cleanups.push(() => {
        history.pushState = origPushState;
        window.removeEventListener("popstate", onPop);
      });
    }

    if (enabled.clicks) {
      const onClick = (e) => {
        const el = e.target?.closest?.("[data-mx]");
        if (!el) return;
        client.interaction("click", { mx: el.getAttribute("data-mx") || "", tag: el.tagName, id: el.id || "" });
      };

      document.addEventListener("click", onClick, true);
      cleanups.push(() => document.removeEventListener("click", onClick, true));
    }

    if (enabled.forms) {
      const onSubmit = (e) => {
        const form = e.target;
        if (!(form instanceof HTMLFormElement)) return;
        client.interaction("form_submit", { formId: form.id || "", method: form.method || "", action: form.action || "" });
      };

      document.addEventListener("submit", onSubmit, true);
      cleanups.push(() => document.removeEventListener("submit", onSubmit, true));
    }

    if (enabled.errors) {
      const onError = (e) => {
        client.track("error_unhandled", { message: e.message || "", source: e.filename || "", line: e.lineno || 0, col: e.colno || 0 });
      };

      const onRejection = (e) => {
        client.track("promise_rejection", { message: String(e.reason?.message || e.reason || "") });
      };

      window.addEventListener("error", onError);
      window.addEventListener("unhandledrejection", onRejection);

      cleanups.push(() => {
        window.removeEventListener("error", onError);
        window.removeEventListener("unhandledrejection", onRejection);
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
  function init(config) {
    if (!config?.projectId || !config?.botId) throw new Error("projectId and botId required");

    // IMPORTANT: TelegramBotId is NOT available from Telegram.WebApp JS.
    // You must pass it from your app config/DB.
    if (typeof config.telegramBotId !== "number" || !Number.isFinite(config.telegramBotId) || config.telegramBotId <= 0) {
      throw new Error("telegramBotId (numeric) is required for WebApp auth verification");
    }

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
      telegramBotId: config.telegramBotId,
      // auth: optional override. If not provided, uses Telegram.WebApp.initData.
      auth: config.auth,
      queue: [],
      timer: null,
      flushing: false,
      alive: true,
      cleanupFns: [],
    };

    function baseProps(extra) {
      const p = Object.assign({}, extra);
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

    function enqueue(evt) {
      if (!state.alive) return;

      if (state.queue.length >= opts.maxQueue) {
        state.queue.splice(0, state.queue.length - opts.maxQueue + 1);
      }

      state.queue.push(evt);

      if (state.queue.length >= opts.maxBatch) flush();
      else scheduleFlush();
    }

    function pushEvent(eventType, eventName, props, text) {
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
      // If caller provides auth() override, use it.
      // Otherwise take Telegram.WebApp.initData as-is.
      if (typeof state.auth === "function") {
        const v = await state.auth();
        return v?.initData ?? "";
      }
      if (state.auth && typeof state.auth === "object") {
        return state.auth.initData ?? "";
      }
      return global.Telegram?.WebApp?.initData ?? "";
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
            TelegramBotId: state.telegramBotId,
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

    const client = {
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

  global.MetrioxTG = { init };
})(window);
