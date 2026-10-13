---
"effect-inngest": patch
---

`SendEventError.message` no longer contains the event API URL, which carries the event key. It names the HTTP client failure and status, plus the Inngest `error` text when the response body has one, for example `Failed to send events: StatusCodeError 401: Event key not found`.
