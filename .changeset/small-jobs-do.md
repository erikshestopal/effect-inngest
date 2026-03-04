---
"effect-inngest": patch
---

Fix: Wrap handler invocation with Effect.scoped in driver.ts so that Effect.acquireRelease finalizers run after each handler completes, instead of leaking onto the application-level scope and only running at server shutdown.
