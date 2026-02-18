---
"effect-inngest": patch
---

Fix `rateLimit`, `throttle`, `debounce`, `concurrency`, `priority`, `singleton`, `batchEvents`, and `idempotency` being silently dropped during function registration. These options are now correctly serialized in the registration payload sent to the Inngest API.
