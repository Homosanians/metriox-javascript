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
    maxQueue: 500, // cap in-memory queue
    retryBaseMs: 400,
    retryCount: 2,
    auto: false, // false | true | { page, nav, clicks, forms, errors }
  };

  // =========================
  // Helpers
  // =========================
  function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }

  function uuid() {
    // Prefer crypto.randomUUID; fallback is deterministic enough for client-side IDs
    return crypto?.randomUUID?.() ?? ([1e7] + -1e3 + -4e3 + -8e3 + -1e11).replace(/[018]/g, (c) => (c ^ (crypto.getRandomValues(new Uint8Array(1))[0] & (15 >> (c / 4)))).toString(16));
  }

  function clampString(value, maxLen) {
    if (typeof value !== "string") return value;
    if (value.length <= maxLen) return value;
    return value.slice(0, maxLen);
  }

  /**
   * Split props into DTO fields:
   * - PropsString: string (and fallback JSON/stringified values)
   * - PropsLong: safe integers
   * - PropsBool: booleans
   */
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

      // objects/arrays -> JSON string (best effort)
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
    if (auto === true) {
      return { page: true, nav: true, clicks: true, forms: true, errors: true };
    }
    if (!auto) return { page: false, nav: false, clicks: false, forms: false, errors: false };
    return {
      page: !!auto.page,
      nav: !!auto.nav,
      clicks: !!auto.clicks,
      forms: !!auto.forms,
      errors: !!auto.errors,
    };
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
    // ✅ Only beacon on same-origin
    if (isSameOrigin(ENDPOINT)) {
      try {
        if (navigator.sendBeacon) {
          const blob = new Blob([JSON.stringify(body)], { type: "application/json" });
          const ok = navigator.sendBeacon(ENDPOINT, blob);
          if (ok) return true;
        }
      } catch {}
    }

    // fetch path (explicitly non-credentialed)
    for (let attempt = 0; attempt <= retryCount; attempt++) {
      try {
        const res = await fetch(ENDPOINT, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
          keepalive: true,
          credentials: "omit", // ✅
        });
        if (res.ok) return true;
      } catch {}
      if (attempt < retryCount) await sleep(retryBaseMs * Math.pow(2, attempt));
    }
    return false;
  }

  // =========================
  // Auto instrumentation (plugin)
  // Returns cleanup() function
  // =========================
  function attachAuto(client, autoOptions) {
    const enabled = mergeAuto(autoOptions);
    const cleanups = [];

    // page view
    if (enabled.page) {
      client.page("page_view", { path: location.pathname + location.search, title: document.title });
    }

    // navigation tracking (pushState + popstate)
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

    // clicks: only elements with data-mx
    if (enabled.clicks) {
      const onClick = (e) => {
        const el = e.target?.closest?.("[data-mx]");
        if (!el) return;
        client.interaction("click", {
          mx: el.getAttribute("data-mx") || "",
          tag: el.tagName,
          id: el.id || "",
        });
      };

      document.addEventListener("click", onClick, true);
      cleanups.push(() => document.removeEventListener("click", onClick, true));
    }

    // forms
    if (enabled.forms) {
      const onSubmit = (e) => {
        const form = e.target;
        if (!(form instanceof HTMLFormElement)) return;
        client.interaction("form_submit", {
          formId: form.id || "",
          method: form.method || "",
          action: form.action || "",
        });
      };

      document.addEventListener("submit", onSubmit, true);
      cleanups.push(() => document.removeEventListener("submit", onSubmit, true));
    }

    // errors
    if (enabled.errors) {
      const onError = (e) => {
        client.track("error_unhandled", {
          message: e.message || "",
          source: e.filename || "",
          line: e.lineno || 0,
          col: e.colno || 0,
        });
      };

      const onRejection = (e) => {
        client.track("promise_rejection", {
          message: String(e.reason?.message || e.reason || ""),
        });
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
        } catch {
          // ignore
        }
      }
    };
  }

  // =========================
  // Client init
  // =========================
  function init(config) {
    if (!config?.projectId || !config?.botId) {
      throw new Error("projectId and botId required");
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
      auth: config.auth, // function | object
      queue: [],
      timer: null,
      flushing: false,
      alive: true,
      cleanupFns: [],
    };

    // add sdk info to all events
    function baseProps(extra) {
      const p = Object.assign({}, extra);
      p.sdk = SDK_NAME;
      p.sdk_version = SDK_VERSION;
      return p;
    }

    function scheduleFlush() {
      if (!state.alive) return;
      if (state.timer) return;

      state.timer = setTimeout(() => {
        state.timer = null;
        flush();
      }, opts.flushMs);
    }

    function enqueue(evt) {
      if (!state.alive) return;

      // cap queue; drop oldest
      if (state.queue.length >= opts.maxQueue) {
        state.queue.splice(0, state.queue.length - opts.maxQueue + 1);
      }

      state.queue.push(evt);

      if (state.queue.length >= opts.maxBatch) flush();
      else scheduleFlush();
    }

    function pushEvent(eventType, eventName, props, text) {
      const evt = {
        EventId: uuid(),
        EventType: String(eventType),
        EventName: String(eventName),
        EventDate: new Date().toISOString(),
        Text: text,
        ...splitProps(baseProps(props)),
      };
      enqueue(evt);
    }

    async function flush() {
      if (!state.alive) return;
      if (state.flushing) return;
      if (!state.queue.length) return;

      state.flushing = true;

      try {
        // batch
        const events = state.queue.splice(0, opts.maxBatch);

        const auth = typeof state.auth === "function" ? await state.auth() : state.auth || {};

        const body = {
          ProjectId: state.projectId,
          BotId: state.botId,
          Auth: {
            Statement: auth.statement || "",
            Signature: auth.signature || "",
          },
          Events: events,
        };

        const ok = await sendRequest(body, opts.retryCount, opts.retryBaseMs);

        if (!ok) {
          // put failed events back in front
          state.queue = events.concat(state.queue);
          scheduleFlush();
        } else if (state.queue.length) {
          // if more queued, flush soon
          scheduleFlush();
        }
      } finally {
        state.flushing = false;
      }
    }

    // PUBLIC API
    const client = {
      /** Custom event: track("product_view", { ... }) => EventType=custom, EventName=custom:product_view */
      track(name, props, options) {
        pushEvent("custom", `custom:${name}`, props, options?.text);
      },
      /** Page events: page("page_view" | "navigation", props) */
      page(name, props) {
        pushEvent("page", name, props);
      },
      /** Interaction events: interaction("click" | "form_submit", props) */
      interaction(name, props) {
        pushEvent("interaction", name, props);
      },
      flush,
      shutdown() {
        state.alive = false;

        if (state.timer) clearTimeout(state.timer);
        state.timer = null;

        // cleanup auto listeners + visibility listener
        for (const fn of state.cleanupFns) {
          try {
            fn();
          } catch {
            // ignore
          }
        }
        state.cleanupFns = [];
      },
    };

    // Auto instrumentation (optional)
    if (opts.auto) {
      const cleanupAuto = attachAuto(client, opts.auto);
      state.cleanupFns.push(cleanupAuto);
    }

    // flush when going to background
    const onVis = () => {
      if (document.visibilityState === "hidden") client.flush();
    };
    document.addEventListener("visibilitychange", onVis);
    state.cleanupFns.push(() => document.removeEventListener("visibilitychange", onVis));

    return client;
  }

  global.MetrioxTG = { init };
})(window);
