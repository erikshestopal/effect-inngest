---
"effect-inngest": patch
---

Request signature verification now matches the native SDK. `PreparedSigningKey` strips the `signkey-<env>-` prefix and uses the UTF-8 bytes of the remaining hex text as the HMAC key, so signatures from Inngest Cloud verify and `Signature.sign` produces the same response header the native SDK does. Signature and request-body failures now answer as `401` and `400` responses with `x-inngest-no-retry: true` instead of a `500`, and the `500` for a genuine defect logs the cause instead of returning it in the body.
