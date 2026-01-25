# effect-inngest

Native Effect client library for Inngest - durable, type-safe workflows.

## Commands

- **Typecheck**: `bun run typecheck` (uses tsgo)
- **Lint**: `bun run lint` (oxlint with type-aware checking)
- **Build**: `bun run build` (tsdown)
- **Test all**: `bun test`
- **Single test**: `bun test test/unit/memo.test.ts`
- **E2E tests**: `bun run test:e2e`

## Architecture

```
src/
├── index.ts          # Re-exports all public modules
├── Client.ts         # InngestClient service - sends events, manages config (dev/cloud modes)
├── Events.ts         # Built-in Inngest events (FunctionFailed, FunctionFinished)
├── Function.ts       # InngestFunction.make() - define triggers, retries, concurrency, rate limits
├── Group.ts          # InngestGroup.make() - aggregate functions, create handler layers, HTTP app
├── HttpApi.ts        # @effect/platform HttpApi integration (InngestApiGroup, layerGroup)
└── internal/         # Private implementation (not exported)
    ├── driver.ts     # ExecutionResult, runs handler with memoized steps, collects interrupts
    ├── errors.ts     # Tagged errors: NonRetriableError, RetryAfterError, StepError, etc.
    ├── handler.ts    # HTTP request handling: introspect, register, execute endpoints
    ├── helpers.ts    # Duration→timeStr conversion, timestamp formatting
    ├── interrupts.ts # StepInterrupt schema, factory fns (sleepInterrupt, invokeInterrupt, etc.)
    ├── memo.ts       # Step memoization: decode cached results (MemoData/Error/Timeout/None)
    ├── protocol.ts   # Wire protocol schemas: opcodes, StepResult, introspection/registration
    ├── signature.ts  # HMAC signature verification for Inngest requests
    └── step.ts       # Step tools: step.run, step.sleep, step.waitForEvent, step.invoke
test/
├── unit/             # Unit tests (bun:test)
├── integration/      # Integration tests
└── e2e/              # End-to-end tests with Inngest dev server
```
