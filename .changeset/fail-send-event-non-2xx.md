---
"effect-inngest": patch
---

`InngestClient.sendEvent` fails with `SendEventError` on a non-2xx response from the event API instead of returning the decoded body as success. The error carries the HTTP status in `status`.
