# effect-inngest

## 0.4.0

### Minor Changes

- [`1a0fe79`](https://github.com/erikshestopal/effect-inngest/commit/1a0fe79a4e6eac39453d7de73a2d563295f7c45d) Thanks [@erikshestopal](https://github.com/erikshestopal)! - Treat blank event keys as missing when sending events in dev mode.

- [#5](https://github.com/erikshestopal/effect-inngest/pull/5) [`6b43c88`](https://github.com/erikshestopal/effect-inngest/commit/6b43c88fb13a3e23c71db48d2454d86e463d59b6) Thanks [@pattobrien](https://github.com/pattobrien)! - Effect 4.0.0 stable. The `effect` peer moves from `>=4.0.0-beta.83` to `^4.0.0`, and the `effect`, `@effect/platform-bun` and `@effect/vitest` dev dependencies move to `4.0.0`. Source follows the beta-to-stable renames: `effect/unstable/http*` to `effect/http*`, `Schema.TaggedErrorClass` to `Schema.TaggedError`, `Schedule.both` to `Schedule.max`, `Config.string` to `Config.String`, `HttpApiGroup.Any`/`ApiGroup` to `Constraint`/`Service`, `Headers.HeadersSchema` to `Schema.Headers`, `UrlParams.schemaRecord` to `Schema.RecordFromUrlParams`, `Encoding.encodeHex` to `Hex.encode`, and `Schema.DateValid` to `Schema.Date`.

  Breaking: requires `effect@^4.0.0`. Beta peers no longer satisfy the range.

- [`0c0dae1`](https://github.com/erikshestopal/effect-inngest/commit/0c0dae1f173d38e2a95aedc664811277571f2f9d) Thanks [@erikshestopal](https://github.com/erikshestopal)! - Effect v4 (beta) upgrade. Migrates from Effect 3.x to 4.0.0-beta with the new `effect-smol` package layout. Adds checkpoint mode for buffered step flushing on async opcode boundaries (spec §10.2 / §10.4.1). Test runner moved from bun-test/tsdown to vitest/vite. Module shape and public API preserved; consumers still import `InngestClient`, `InngestFunction`, `InngestGroup` from the package root.

  Breaking: requires `effect@^4.0.0-beta` peer. Pre-1.0 convention treats this as a minor bump.

- [`2b74600`](https://github.com/erikshestopal/effect-inngest/commit/2b74600c284f4694850c6f6c1c38cfcf50a4d611) Thanks [@erikshestopal](https://github.com/erikshestopal)! - Release the Effect v4 runtime refactor, event definition API, protocol recorder, schema-aware step APIs, and stabilized execution seams.

- [`acac676`](https://github.com/erikshestopal/effect-inngest/commit/acac67658f4df6eca9ae89cafcc841a1f4ff454d) Thanks [@erikshestopal](https://github.com/erikshestopal)! - Remove public result schemas, move durable workflow operations from handler-scoped `step.*` tools to module-level `Inngest.*` functions, and simplify function triggers to accept event definitions or `InngestCron.make(...)` directly. Step and function results are normalized through JSON wire semantics before memoization/replay.

### Patch Changes

- [`cb0f45e`](https://github.com/erikshestopal/effect-inngest/commit/cb0f45ea5d4e1ca5453197beba1333c032cd7f82) Thanks [@erikshestopal](https://github.com/erikshestopal)! - Fix checkpointing async dispatch behavior.

- [#4](https://github.com/erikshestopal/effect-inngest/pull/4) [`3ad748a`](https://github.com/erikshestopal/effect-inngest/commit/3ad748a920914776e0aa6e054ccd9fbb465ae3dd) Thanks [@captain-mirage](https://github.com/captain-mirage)! - Preserve the handler response status and Inngest protocol headers when serving through `InngestHttpApi.layerGroup`.

- [`d308ca9`](https://github.com/erikshestopal/effect-inngest/commit/d308ca9144d3b8dc50672effd141d16e3181b63b) Thanks [@erikshestopal](https://github.com/erikshestopal)! - Fix public declaration exports and update `cancelOn.event` to use event definitions.

- [#6](https://github.com/erikshestopal/effect-inngest/pull/6) [`2f84806`](https://github.com/erikshestopal/effect-inngest/commit/2f84806cc3bcb3eab57e59e8a4cbd5430cae026e) Thanks [@pattobrien](https://github.com/pattobrien)! - Cloud registration now authenticates the way the native SDK does. The `PUT` register request sends `Bearer <hashed signing key>` instead of the raw key, and sends `X-Inngest-Env` when the client config has an env. `hashSigningKey` keeps the `signkey-<env>-` prefix and hashes the hex-decoded key bytes, which also corrects the checkpoint token. `InngestClient.layerFromEnv` now reads `INNGEST_ENV` and `INNGEST_DEV`, defaulting to cloud mode, as its docstring already said.

- [`b238e91`](https://github.com/erikshestopal/effect-inngest/commit/b238e91206a31b8700355b77f5b60f4672cadcea) Thanks [@erikshestopal](https://github.com/erikshestopal)! - Export normalized trigger types used by function declarations and accept cron trigger objects.

- [#9](https://github.com/erikshestopal/effect-inngest/pull/9) [`2ec141d`](https://github.com/erikshestopal/effect-inngest/commit/2ec141dc8b1e55329e0bedee9beda88183dd7b53) Thanks [@pattobrien](https://github.com/pattobrien)! - `InngestClient.sendEvent` fails with `SendEventError` on a non-2xx response from the event API instead of returning the decoded body as success. The error carries the HTTP status in `status`.

- [#8](https://github.com/erikshestopal/effect-inngest/pull/8) [`f1bbad9`](https://github.com/erikshestopal/effect-inngest/commit/f1bbad96bcb4f7a856228acda5a5fbf7b16c35e5) Thanks [@pattobrien](https://github.com/pattobrien)! - Forward the `deployId` query parameter of a sync request to `fn/register` in both the register URL and body, so Inngest Cloud can tie the registration to its sync.

- [#9](https://github.com/erikshestopal/effect-inngest/pull/9) [`2ec141d`](https://github.com/erikshestopal/effect-inngest/commit/2ec141dc8b1e55329e0bedee9beda88183dd7b53) Thanks [@pattobrien](https://github.com/pattobrien)! - `SendEventError.message` no longer contains the event API URL, which carries the event key. It names the HTTP client failure and status, plus the Inngest `error` text when the response body has one, for example `Failed to send events: StatusCodeError 401: Event key not found`.

- [`c6f67ad`](https://github.com/erikshestopal/effect-inngest/commit/c6f67ada961c61324745cb9e4f5bc3afa5eac5ea) Thanks [@erikshestopal](https://github.com/erikshestopal)! - Skip signing key validation when request signature verification is disabled in dev mode.

- [#7](https://github.com/erikshestopal/effect-inngest/pull/7) [`2319db6`](https://github.com/erikshestopal/effect-inngest/commit/2319db67f311775ad953bb452425186d119d14d6) Thanks [@pattobrien](https://github.com/pattobrien)! - Request signature verification now matches the native SDK. `PreparedSigningKey` strips the `signkey-<env>-` prefix and uses the UTF-8 bytes of the remaining hex text as the HMAC key, so signatures from Inngest Cloud verify and `Signature.sign` produces the same response header the native SDK does. Signature and request-body failures now answer as `401` and `400` responses with `x-inngest-no-retry: true` instead of a `500`, and the `500` for a genuine defect logs the cause instead of returning it in the body.

- [`bcbdc2e`](https://github.com/erikshestopal/effect-inngest/commit/bcbdc2e4554369de6770af90b0d2403f95adaefa) Thanks [@erikshestopal](https://github.com/erikshestopal)! - Fix handler event type inference for mixed batched and non-batched groups, and add public type coverage for router launch composition.

## 0.4.0-beta2

### Patch Changes

- [`b238e91`](https://github.com/erikshestopal/effect-inngest/commit/b238e91206a31b8700355b77f5b60f4672cadcea) Thanks [@erikshestopal](https://github.com/erikshestopal)! - Export normalized trigger types used by function declarations and accept cron trigger objects.

## 0.4.0-beta1

### Minor Changes

- [`1a0fe79`](https://github.com/erikshestopal/effect-inngest/commit/1a0fe79a4e6eac39453d7de73a2d563295f7c45d) Thanks [@erikshestopal](https://github.com/erikshestopal)! - Treat blank event keys as missing when sending events in dev mode.

- [`acac676`](https://github.com/erikshestopal/effect-inngest/commit/acac67658f4df6eca9ae89cafcc841a1f4ff454d) Thanks [@erikshestopal](https://github.com/erikshestopal)! - Remove public result schemas, move durable workflow operations from handler-scoped `step.*` tools to module-level `Inngest.*` functions, and simplify function triggers to accept event definitions or `InngestCron.make(...)` directly. Step and function results are normalized through JSON wire semantics before memoization/replay.

## 0.3.0-beta.4

### Patch Changes

- Fix checkpointing async dispatch behavior.

## 0.3.0-beta.3

### Patch Changes

- Skip signing key validation when request signature verification is disabled in dev mode.

## 0.3.0-beta.2

### Patch Changes

- Fix handler event type inference for mixed batched and non-batched groups, and add public type coverage for router launch composition.

## 0.3.0-beta.1

### Patch Changes

- Fix public declaration exports and update `cancelOn.event` to use event definitions.

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
