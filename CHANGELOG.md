# effect-inngest

## 0.1.3

### Patch Changes

- [`551ca9a`](https://github.com/erikshestopal/effect-inngest/commit/551ca9a0a0e316162d3c6f347ba15f54c04cc064) Thanks [@erikshestopal](https://github.com/erikshestopal)! - Fix: Wrap handler invocation with Effect.scoped in driver.ts so that Effect.acquireRelease finalizers run after each handler completes, instead of leaking onto the application-level scope and only running at server shutdown.

## 0.1.2

### Patch Changes

- [`c51e481`](https://github.com/erikshestopal/effect-inngest/commit/c51e481e2c05e7ca7c764503e717e0bccb78699d) Thanks [@erikshestopal](https://github.com/erikshestopal)! - Fix recursive stripTags destroying nested \_tag required for Schema.Union discrimination. Encode event data via Schema.encode before wire transmission in step.invoke and step.sendEvent.

## 0.1.1

### Patch Changes

- [`bc66e82`](https://github.com/erikshestopal/effect-inngest/commit/bc66e822f4a54e7af47c234f929dfab003fe7527) Thanks [@erikshestopal](https://github.com/erikshestopal)! - Fix `rateLimit`, `throttle`, `debounce`, `concurrency`, `priority`, `singleton`, `batchEvents`, and `idempotency` being silently dropped during function registration. These options are now correctly serialized in the registration payload sent to the Inngest API.
