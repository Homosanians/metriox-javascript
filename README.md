<!-- @format -->

# Metriox SDK for JS

## Options

| Option        | Type                               | Required | Default | Description                                      |
| ------------- | ---------------------------------- | -------: | ------: | ------------------------------------------------ |
| `botId`       | `string` (Guid)                    |       ✅ |       — | Your bot id                                      |
| `auth`        | `() => ({initData}) \| {initData}` |       ✅ |       — | Telegram auth payload provider                   |
| `auto`        | `boolean \| object`                |       ❌ | `false` | Enable automatic tracking                        |
| `context`     | `boolean`                          |       ❌ |  `true` | Attach the WebApp/browser context to every event |
| `flushMs`     | `number`                           |       ❌ |  `5000` | Flush interval in ms                             |
| `maxBatch`    | `number`                           |       ❌ |    `20` | Max events per request                           |
| `maxQueue`    | `number`                           |       ❌ |   `500` | Max queued events in memory                      |
| `retryCount`  | `number`                           |       ❌ |     `2` | Fetch retry attempts                             |
| `retryBaseMs` | `number`                           |       ❌ |   `400` | Base retry delay (exponential backoff)           |
| `endpoint`    | `string`                           |       ❌ |  hosted | Full ingest URL (self-hosting, staging, local)   |
| `projectId`   | `string` (Guid)                    |       ❌ |       — | Deprecated and ignored — see below               |

`projectId` no longer does anything and is no longer required. The ingest resolves the owning project from `botId` itself and deliberately refuses to trust a caller-supplied project id, so passing one only ever looked like it mattered. The field is still accepted so existing code keeps compiling.

### Telegram WebApp

```
<script src="https://cdn.jsdelivr.net/npm/metriox-javascript/dist/metriox-tg-webapp.min.js"></script>
<script>
  const mx = window.MetrioxTG.init({
    botId: "<YOUR_BOT_ID>",

    auth: () => ({ initData: window.Telegram?.WebApp?.initData || "" }),

    auto: true
  });

  mx.track("user_start", { appVersion: "prod/1.2.1", userCredits: 1999, boosterActive: true });

  // A custom event may name its category; without one it is recorded as "platform"
  mx.track("purchase_completed", { price: 299 }, { type: "payment" });

  // Force send immediately
  mx.flush();
</script>
```

### Event categories

`track()` takes a canonical `$event.type` through `options.type`. The vocabulary is the server's, exported as `EVENT_TYPES`:

`message`, `interaction`, `payment`, `membership`, `business`, `poll`, `reaction`, `boost`, `platform`

Anything else — an omitted value included — is recorded as `platform`, which is exactly what the server does with a category it does not know. Up to 0.1.x this SDK sent `custom` and `page`, neither of which was ever a category, so every event arrived carrying an `event_type_unknown` warning.

### What is collected automatically

With `context: true` (the default) every event carries the launch and device context: `session_id`, `seq`, `tg_platform`, `tg_client_version`, `tg_color_scheme`, `tg_viewport_h`, `tg_is_expanded`, `tg_is_fullscreen`, `tg_is_active`, `path`, `referrer`, `language`, `timezone`, `screen_w`/`screen_h`, `viewport_w`/`viewport_h`, `dpr_x100`.

Nothing from `initData` is re-sent: the user, chat type, chat instance and start param are derived server-side from the signed string, so the SDK spends no bytes on them.

`auto: true` additionally records page views, SPA navigation, `data-mx` clicks, form submits, unhandled errors, and Telegram lifecycle events — main/secondary/back/settings button presses, popup and invoice results, and theme, viewport, fullscreen and activation changes. QR and clipboard callbacks are recorded as occurrences only; the scanned or pasted text is never sent.

Enable a subset with an object, e.g. `auto: { page: true, tg: true }`.

### Frameworks

`init()` is safe to call during a server render: it detects the absence of a DOM, skips every listener, and hands back a client whose methods are inert. Nothing needs a `typeof window` guard at the call site. The browser instance created during hydration is the one that records.

What still matters is *where* you call it, because a Mini App only has `initData` in the browser.

**Plain JS** — the IIFE bundle exposes `window.MetrioxTG`; see the snippet above.

**React / Next.js** — the provider handles it; on the server it renders without creating a client.

```jsx
import { MetrioxProvider } from "metriox-javascript/react";

<MetrioxProvider config={{ botId: "<BOT_ID>", auth: () => ({ initData: window.Telegram?.WebApp?.initData || "" }) }} />;
```

In the App Router, put it in a `"use client"` component.

**Vue / Nuxt**

```js
import { onMounted } from "vue";
import { init } from "metriox-javascript";

onMounted(() => {
  const mx = init({ botId: "<BOT_ID>", auth: () => ({ initData: window.Telegram?.WebApp?.initData || "" }), auto: true });
});
```

**Svelte / SvelteKit**

```js
import { onMount } from "svelte";
import { init } from "metriox-javascript";

onMount(() => {
  const mx = init({ botId: "<BOT_ID>", auth: () => ({ initData: window.Telegram?.WebApp?.initData || "" }), auto: true });
  return () => mx.shutdown();
});
```

**Angular**

```ts
import { Component, OnInit, OnDestroy } from "@angular/core";
import { init, type MetrioxClient } from "metriox-javascript";

@Component({ selector: "app-root", template: "" })
export class AppComponent implements OnInit, OnDestroy {
  private mx?: MetrioxClient;

  ngOnInit() {
    this.mx = init({ botId: "<BOT_ID>", auth: () => ({ initData: window.Telegram?.WebApp?.initData || "" }), auto: true });
  }

  ngOnDestroy() {
    this.mx?.shutdown();
  }
}
```

### Delivery

A batch is retried on network failure, `408`, `429` and any `5xx`. Any other `4xx` is a verdict the batch cannot pass, so it is dropped rather than re-queued — retrying it forever would hold back every event behind it.

A request is also bounded by size, not just by `maxBatch`: browsers cap a `keepalive` body at 64KB and reject anything larger outright, and `keepalive` is what lets the flush on app close finish at all. Events that do not fit go back to the front of the queue and leave in the next request, so a batch may be smaller than `maxBatch` when properties are large.

Events are POSTed to Metriox's hosted ingest unless `endpoint` says otherwise:

```js
init({ botId: "<BOT_ID>", auth, endpoint: "https://ingest.example.com/tg/webapp" });
```

---

### Serializing an inline keyboard

`serializeInlineKeyboard(markup)` turns a Bot API `InlineKeyboardMarkup` into the compact JSON Metriox stores at `$tg.inline_keyboard`, so the per-user conversation view can show which buttons a message offered and resolve a pressed callback back to its button label. Callback buttons keep their data, url buttons keep their url; other button kinds are skipped.

```js
import { serializeInlineKeyboard } from "metriox-javascript";

serializeInlineKeyboard({
  inline_keyboard: [[{ text: "Buy", callback_data: "buy" }, { text: "Docs", url: "https://metriox.com" }]],
});
// => '[{"text":"Buy","callback_data":"buy"},{"text":"Docs","url":"https://metriox.com"}]'
```

Send the result as `tg.inline_keyboard` on a Telegram message event, alongside `tg.from_is_bot: true` so it renders as a bot → user message. This is usually done server-side, since the Bot API never reports a bot's own sends. It works from a WebApp too: WebApp events used to be classified as custom and skipped `$tg` promotion entirely, but the ingest now stamps them platform-origin like every other Telegram-derived event. Returns `null` when there is nothing to record.

---

### React integration

The package exports a React entry at `metriox-javascript/react`. This build marks `react` as a peer dependency — install React in your app.

#### Example app

A minimal example app is provided at `example/react` to demonstrate provider-level initialization, `eventProperties`, render-prop helpers, and opt-in `auto` instrumentation (captures `data-mx` clicks/submits inside provider subtree).

Quick start:

```bash
# build the library (so example imports local ESM)
npm run build

# start the example
cd example/react
npm install
npm run dev
# open http://localhost:5173
```

JavaScript usage:

```js
import React from "react";
import { MetrioxProvider, Metriox, LogOnMount, LogOnChange, useLogEvent } from "metriox-javascript/react";

function App() {
  return (
    <MetrioxProvider config={{ botId: "b", auth: () => ({ initData: "" }) }} eventProperties={{ app: "my-app" }}>
      <Main />
    </MetrioxProvider>
  );
}

function Main() {
  // Scoped properties for this subtree and a render-prop helper
  return <Metriox eventProperties={{ scope: ["home"] }}>{({ logEvent, instrument }) => <button onClick={instrument("click-home", () => console.log("clicked"))}>Click</button>}</Metriox>;
}

// Log on mount
function Mounted() {
  return <LogOnMount eventType="page_open" eventProperties={{ source: "mounted" }} />;
}

// Log when a value changes
function Changes({ x }) {
  return <LogOnChange value={x} eventType="value_changed" />;
}
```

TypeScript usage:

```ts
import React from 'react';
import type { Config } from 'metriox-javascript';
import { MetrioxProvider, Metriox, useLogEvent } from 'metriox-javascript/react';

const cfg: Config = { botId: 'b', auth: () => ({ initData: '' }) };

<MetrioxProvider config={cfg} eventProperties={{ app: 'my-app' }}>
  <Metriox eventProperties={(inherited) => ({ ...inherited, scope: ['page'] })}>
    {({ logEvent }) => {
      React.useEffect(() => {
        logEvent('page_view');
      }, []);
      return null;
    }}
  </Metriox>
</MetrioxProvider>;
```

---

### Publishing to npm

The repo includes helper scripts to prepare and publish to npm.

- Build + typecheck + tests before publish (automatically via `prepublishOnly`).
- Publish command:

```bash
npm run publish:npm
# Or (manual):
# npm run build
# npm publish --access public
```

Make sure you are logged in (`npm login`) and have permission to publish the package.

---
