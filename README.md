<!-- @format -->

# Metriox SDK for JS

## Options

| Option        | Type                                                       | Required | Default | Description                            |
| ------------- | ---------------------------------------------------------- | -------: | ------: | -------------------------------------- |
| `projectId`   | `string` (Guid)                                            |       ✅ |       — | Your Metriox project id                |
| `botId`       | `string` (Guid)                                            |       ✅ |       — | Your bot id                            |
| `auth`        | `() => ({statement, signature}) \| {statement, signature}` |       ✅ |       — | Telegram auth payload provider         |
| `auto`        | `boolean \| object`                                        |       ❌ | `false` | Enable automatic tracking              |
| `flushMs`     | `number`                                                   |       ❌ |  `5000` | Flush interval in ms                   |
| `maxBatch`    | `number`                                                   |       ❌ |    `20` | Max events per request                 |
| `maxQueue`    | `number`                                                   |       ❌ |   `500` | Max queued events in memory            |
| `retryCount`  | `number`                                                   |       ❌ |     `2` | Fetch retry attempts                   |
| `retryBaseMs` | `number`                                                   |       ❌ |   `400` | Base retry delay (exponential backoff) |

### Telegram WebApp

```
<script src="https://cdn.jsdelivr.net/npm/metriox-javascript/dist/metriox-tg-webapp.min.js"></script>
<script>
  const mx = window.MetrioxTG.init({
    projectId: "<YOUR_PROJECT_ID>",
    botId: "<YOUR_BOT_ID>",
    telegramBotId: <YOUR_TELEGRAM_BOT_ID>,

    auth: () => ({ initData: window.Telegram?.WebApp?.initData || "" }),

    auto: true
  });

  mx.track("user_start", { appVersion: "prod/1.2.1", userCredits: 1999, boosterActive: true });

  // Force send immediately
  mx.flush();
</script>
```
