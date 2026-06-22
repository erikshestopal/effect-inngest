# effect-inngest

## 0.3.0-beta.0

### Minor Changes

- Release the Effect v4 runtime refactor, event definition API, protocol recorder, schema-aware step APIs, and stabilized execution seams.

## 0.2.0-beta.0

### Minor Changes

- Effect v4 (beta) upgrade. Migrates from Effect 3.x to 4.0.0-beta with the new `effect-smol` package layout. Adds checkpoint mode for buffered step flushing on async opcode boundaries (spec §10.2 / §10.4.1). Test runner moved from bun-test/tsdown to vitest/vite. Module shape and public API preserved; consumers still import `InngestClient`, `InngestFunction`, `InngestGroup` from the package root.

  Breaking: requires `effect@^4.0.0-beta` peer. Pre-1.0 convention treats this as a minor bump.

## 0.1.3

### Patch Changes

- [`551ca9a`](https://github.com/erikshestopal/effect-inngest/commit/551ca9a0a0e316162d3c6f347ba15f54c04cc064) Thanks [@erikshestopal](https://github.com/erikshestopal)! - Fix: Wrap handler invocation with Effect.scoped in driver.ts so that Effect.acquireRelease finalizers run after each handler completes, instead of leaking onto the application-level scope and only running at server shutdown.

## 0.1.2

### Patch Changes

- [`c51e481`](https://github.com/erikshestopal/effect-inngest/commit/c51e481e2c05e7ca7c764503e717e0bccb78699d) Thanks [@erikshestopal](https://github.com/erikshestopal)! - Fix recursive stripTags destroying nested \_tag required for Schema.Union discrimination. Encode event data via Schema.encode before wire transmission in step.invoke and step.sendEvent.

## 0.1.1

### Patch Changes

- [`bc66e82`](https://github.com/erikshestopal/effect-inngest/commit/bc66e822f4a54e7af47c234f929dfab003fe7527) Thanks [@erikshestopal](https://github.com/erikshestopal)! - Fix `rateLimit`, `throttle`, `debounce`, `concurrency`, `priority`, `singleton`, `batchEvents`, and `idempotency` being silently dropped during function registration. These options are now correctly serialized in the registration payload sent to the Inngest API.
