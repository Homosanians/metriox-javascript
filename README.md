<!-- @format -->

# Metriox SDK for JS

## Options

| Option        | Type                               | Required | Default | Description                            |
| ------------- | ---------------------------------- | -------: | ------: | -------------------------------------- |
| `projectId`   | `string` (Guid)                    |       ✅ |       — | Your Metriox project id                |
| `botId`       | `string` (Guid)                    |       ✅ |       — | Your bot id                            |
| `auth`        | `() => ({initData}) \| {initData}` |       ✅ |       — | Telegram auth payload provider         |
| `auto`        | `boolean \| object`                |       ❌ | `false` | Enable automatic tracking              |
| `flushMs`     | `number`                           |       ❌ |  `5000` | Flush interval in ms                   |
| `maxBatch`    | `number`                           |       ❌ |    `20` | Max events per request                 |
| `maxQueue`    | `number`                           |       ❌ |   `500` | Max queued events in memory            |
| `retryCount`  | `number`                           |       ❌ |     `2` | Fetch retry attempts                   |
| `retryBaseMs` | `number`                           |       ❌ |   `400` | Base retry delay (exponential backoff) |

### Telegram WebApp

```
<script src="https://cdn.jsdelivr.net/npm/metriox-javascript/dist/metriox-tg-webapp.min.js"></script>
<script>
  const mx = window.MetrioxTG.init({
    projectId: "<YOUR_PROJECT_ID>",
    botId: "<YOUR_BOT_ID>",


    auth: () => ({ initData: window.Telegram?.WebApp?.initData || "" }),

    auto: true
  });

  mx.track("user_start", { appVersion: "prod/1.2.1", userCredits: 1999, boosterActive: true });

  // Force send immediately
  mx.flush();
</script>
```

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
    <MetrioxProvider config={{ projectId: "p", botId: "b", auth: () => ({ initData: "" }) }} eventProperties={{ app: "my-app" }}>
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

const cfg: Config = { projectId: 'p', botId: 'b', auth: () => ({ initData: '' }) };

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

### Dedupe / Once-only events 🔧

You can configure the SDK to suppress repeated "once-only" events (for example, `app_open`) so integrators don't have to write brittle local logic. The SDK supports two modes:

- `once` — persist a sent flag (default uses `localStorage`) and suppress identical events until TTL expires (default 24 hours).
- `session` — suppress within a browser session (uses `sessionStorage`).

Client config example:

```js
const mx = MetrioxTG.init({
  projectId: "<YOUR_PROJECT_ID>",
  botId: "<YOUR_BOT_ID>",
  auth: () => ({ initData: window.Telegram?.WebApp?.initData || "" }),

  // Enable dedupe by default (mode: "once")
  dedupe: { mode: "once", defaultTtlMs: 24 * 60 * 60 * 1000 },
});
```

Per-call or React helper usage:

```jsx
// Track with dedupe explicitly
mx.track("app_open", {}, { dedupe: "once" });

// Or use the React helper
<LogOnMount eventType="app_open" dedupe="once" />

// Advanced usage (custom dedupe key and TTL)
<LogOnMount eventType="first_open" dedupe={{ mode: "once", key: "first_open_v1", ttlMs: 1000 * 60 * 60 * 24 }} />
```

Notes & best practices:

- Privacy: Do not include PII in dedupe keys. If your event properties contain user identifiers, pass a safe `key` explicitly (e.g., `first_open_v1`) rather than composing the key from event props.
- SSR & storage unavailability: In non-browser or storage-blocked environments the SDK falls back to a no-op storage adapter and will not throw — dedupe cannot be guaranteed in that case.
- Multi-tab races: Dedupe is best-effort. Simultaneous calls from multiple tabs may still produce duplicates (localStorage is not transactional). For cross-device or cross-tab guarantees, consider server-side dedupe at ingest.

Optional admin/testing API:

- The storage adapter exposes `remove` semantics (adapter dependent). The client exposes a helper `clearDedupeKey(key)` to remove or expire a dedupe key for testing or operational use.

Example:

```js
// Using global client
const mx = MetrioxTG.init({ projectId: "p", botId: "b", auth: () => ({ initData: "" }) });
// Remove stored dedupe key so the next mount or call will send again
await mx.clearDedupeKey("p:app_open");

// In React (inside a component)
import { useMetriox } from "metriox-javascript/react";
const client = useMetriox();
await client.clearDedupeKey("p:app_open");
```

Notes:

- `clearDedupeKey` is asynchronous and best-effort; it will attempt to call the adapter's `remove` method if available, or write an expired value if not.
- Intended for testing and admin workflows; avoid using it in regular app logic that would undermine once-only guarantees.

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
