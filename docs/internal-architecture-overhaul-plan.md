# Internal Architecture Overhaul Plan

This document grounds the internal refactor of `effect-inngest`.

The goal is to make the SDK internals resemble production-grade Effect v4 code while preserving the current public API and the existing test suites exactly. The public API and tests are the gold evaluation. This plan is intentionally not an implementation recipe; it describes boundaries, naming conventions, module design patterns, and migration guardrails to keep the work coherent over multiple sessions.

## Non-negotiables

- Preserve every existing public import path, exported name, method name, overload, and behavior unless an existing test already permits otherwise.
- Preserve the current handler shape, including `HandlerContext`, `ctx.event`, `ctx.step`, and `ctx.run`.
- Preserve existing `step` methods: `run`, `sleep`, `sleepUntil`, `waitForEvent`, `invoke`, and `sendEvent`.
- Preserve all existing tests and examples as the authoritative compatibility suite.
- Refactor internals behind compatibility facades; do not introduce a replacement public API during this overhaul.
- Avoid broad rewrites that leave old and new behavior half-integrated.
- Prefer small, reversible extraction steps over a big-bang rewrite.

## Architecture: public facade over an Effect runtime

The desired design is a strangler refactor of `src/internal`, not a sibling public package. From the outside, this remains the same SDK. Inside, the SDK should look like a small Effect application runtime:

1. public modules define the stable user contract;
2. serve adapters decode incoming HTTP requests into execution input;
3. an execution runtime provides request-scoped services;
4. step operations make domain decisions against memoized state;
5. a command sink records or yields those decisions;
6. wire encoders translate domain decisions into Inngest protocol JSON;
7. client adapters perform outbound IO at the edge.

Current public modules remain the stable API surface:

```txt
src/
  Client.ts
  Events.ts
  Function.ts
  Group.ts
  HttpApi.ts
  index.ts

  internal/
    ...new focused modules introduced gradually...
```

The internal shape should move toward a concrete set of Effect-style runtime modules:

```txt
src/internal/
  domain/       # durable SDK decisions: memo state, step commands, execution signals
  runtime/      # request-scoped Effect services: step tools, memo store, checkpoint buffer
  wire/         # Inngest protocol schemas and encoders
  client/       # outbound Inngest API clients backed by HttpClient
  codec/        # user payload codecs: event payloads and step results
```

### Request execution flow

The architecture should be easiest to understand by following one execution request:

```diagram
╭──────────────────────╮
│ Group / HttpApi      │ existing public serve surface
╰──────────┬───────────╯
           │ receives HTTP request
           ▼
╭──────────────────────╮
│ Request decoding     │ signature, body schema, function lookup
╰──────────┬───────────╯
           │ produces execution input
           ▼
╭──────────────────────╮
│ Execution runtime    │ request-scoped services and handler context
│                      │ Execution, Run, StepTools, MemoStore,
│                      │ StepIdentity, CheckpointBuffer, CommandSink
╰──────────┬───────────╯
           │ runs user handler
           ▼
╭──────────────────────╮
│ Step operation       │ run / sleep / waitForEvent / invoke / sendEvent
│ modules              │ decide: replay memo, execute, plan, yield, buffer
╰──────────┬───────────╯
           │ emits domain decision
           ▼
╭──────────────────────╮
│ StepCommand /        │ typed internal SDK control flow
│ ExecutionSignal      │ no protocol JSON, no HTTP
╰──────────┬───────────╯
           │ command is drained/yielded
           ▼
╭──────────────────────╮
│ Wire response        │ command -> GeneratorOpcode -> HTTP response
│ encoding             │ native Inngest protocol compatibility lives here
╰──────────┬───────────╯
           │
           ▼
╭──────────────────────╮
│ ExecutionResult      │ status, headers, body returned to adapter
╰──────────────────────╯
```

Outbound calls use the same rule: runtime asks an internal service for a capability, and an adapter performs IO.

```diagram
╭──────────────────────╮
│ step.sendEvent       │ existing public StepTools method
╰──────────┬───────────╯
           ▼
╭──────────────────────╮
│ SendEventStep        │ encodes user event payloads, decides memo/buffer/yield
╰──────────┬───────────╯
           ▼
╭──────────────────────╮
│ EventApi service     │ internal Effect service boundary
╰──────────┬───────────╯
           ▼
╭──────────────────────╮
│ Inngest HTTP adapter │ HttpClient, auth, retries, response decoding
╰──────────────────────╯
```

The important property is not the folder names themselves. The important property is that every module belongs to one runtime role.

### Runtime roles

These roles make the architecture concrete:

- **Public facade**: existing `Client`, `Function`, `Group`, `Events`, `HttpApi`, and `index` modules. These preserve user-facing contracts and delegate inward.
- **Serve adapter**: receives framework/HTTP requests, verifies signatures, decodes request bodies, and returns `ExecutionResult` values as HTTP responses.
- **Execution runtime**: builds the request-local environment used while a single Inngest function run is executing.
- **Handler context adapter**: preserves the existing `HandlerContext` object shape by reading request-local runtime services and decoded event data.
- **Step operation modules**: one focused module per step family (`run`, async wait/sleep/invoke, send event). These modules choose between memo replay, execution, planning, yielding, and buffering.
- **Step identity**: resolves a user step id/options value into the internal step identity for this occurrence, including display name, repeat index, order, and hash. This is not a global registry.
- **Memo store**: interprets `request.steps` as domain memo states.
- **Checkpoint buffer**: owns checkpoint buffering, planned command ordering, draining, flushing, and graceful fallback.
- **Command sink**: receives domain step decisions and decides whether to buffer, plan, yield, or include them in the final response.
- **Wire encoder**: converts domain commands and execution outcomes into exact Inngest protocol opcodes, headers, and response bodies.
- **Client adapters**: perform outbound HTTP calls to Inngest for events, checkpointing, and registration.

### Dependency rules

- Public facades may depend on runtime and wire modules but should not expose their types unless already part of the public API.
- Runtime modules may depend on domain models, codecs, request-local services, and internal client services.
- Domain modules must not depend on HTTP, `HttpClient`, framework adapters, or protocol JSON factories.
- Wire modules may depend on domain models and codecs, but should not run user effects or perform outbound IO.
- Wire modules own Inngest-specific scalar codecs such as duration strings and sleep-until timestamp strings.
- Client modules may depend on wire schemas and codecs because they sit at the IO boundary.
- Codec modules should be concept-specific and dependency-light.

This is the production-grade Effect shape we want: public facades, request-scoped services, typed domain decisions, isolated wire encoding, and IO-only adapters.

## Effect v4 prior-art conventions to follow

Use naming and module shapes that match Effect v4 modules such as `OpenAiClient`, `Socket`, `Workflow`, and `Activity`.

### Service modules

For internal dependencies that are real services, prefer this shape:

```ts
export class SomeService extends Context.Service<SomeService, SomeService.Service>()(
  "effect-inngest/internal/SomeService",
) {}

export declare namespace SomeService {
  export interface Service {
    // effectful operations
  }
}

export const make = ...
export const layer = ...
```

Use `make` for constructors and `layer`, `layerConfig`, or `layer*` for `Layer` constructors. Avoid ad hoc names like `createX` unless matching existing public API compatibility.

### Durable definition modules

For value definitions such as functions, steps, commands, or memo states, prefer Effect-style explicit models:

- `TypeId` when runtime identity/refinement is useful.
- `Any` for erased public/internal shapes.
- `Schema.Class`, `Schema.TaggedClass`, or `Schema.TaggedErrorClass` for data and errors that cross boundaries.
- `make` for constructing model values.
- `isX` refinements only when they are actually used.

### Internal compatibility facades

Existing modules may temporarily re-export or delegate to new focused modules. Compatibility facades are acceptable during migration when they keep call sites stable and preserve tests.

Example pattern:

```txt
internal/protocol.ts       # temporary compatibility barrel/facade
internal/wire/Opcode.ts    # focused protocol schema module
internal/wire/Headers.ts   # focused header constants module
```

The goal is not to preserve old internal module names forever; the goal is to keep the public API stable while allowing safe internal extraction.

## Proposed internal module roles

These names are directional. Prefer these patterns unless implementation feedback shows a clearer local name.

### `internal/domain`

Domain modules describe SDK concepts independent of HTTP and protocol JSON.

Possible modules:

```txt
internal/domain/StepInfo.ts
internal/domain/StepCommand.ts
internal/domain/Memo.ts
internal/domain/Execution.ts
internal/domain/Checkpoint.ts
internal/domain/Error.ts
```

Responsibilities:

- model step identity, step decisions, memoized state, execution outcomes, checkpoint configuration, and normalized SDK errors;
- avoid `HttpClient`, request/response adapters, and protocol factory details;
- avoid importing public facades unless doing so preserves a shared public type intentionally.

### `internal/wire`

Wire modules describe the Inngest protocol and conversion into protocol-compatible JSON.

Possible modules:

```txt
internal/wire/Request.ts
internal/wire/Opcode.ts
internal/wire/OpcodeEncoder.ts
internal/wire/Response.ts
internal/wire/Headers.ts
internal/wire/Duration.ts
internal/wire/Timestamp.ts
internal/wire/Registration.ts
internal/wire/Introspection.ts
```

Responsibilities:

- keep `SDKRequestBody`, `SDKRequestContext`, `InngestEvent`, `GeneratorOpcode`, headers, registration, and introspection schemas focused;
- isolate native Inngest protocol compatibility quirks in encoder modules;
- model Inngest-specific scalar values as named Schema codecs or transformations, not generic helper functions;
- keep protocol schemas mostly declarative;
- use `Clock` for time-dependent encoding rather than ambient global time;
- keep domain/runtime decisions out of schema modules.

It is acceptable for `OpcodeEncoder` to contain protocol ugliness. That ugliness belongs in one anti-corruption layer rather than spread through step execution.

For wire scalar conversions, follow Effect v4's codec pattern. Effect's own `Schema.DurationFromString` is defined as a string schema decoded to `Schema.Duration` through `Schema.decodeTo(..., SchemaTransformation.durationFromString)`. Inngest duration strings should follow that shape: a named codec/transformation for `Duration.Duration <-> string`, with the encode side producing Inngest's expected compact protocol representation. Do not introduce wrapper classes for scalar strings.

### `internal/runtime`

Runtime modules coordinate one execution request.

Possible modules:

```txt
internal/runtime/Driver.ts
internal/runtime/HandlerContext.ts
internal/runtime/StepTools.ts
internal/runtime/StepRun.ts
internal/runtime/AsyncSteps.ts
internal/runtime/SendEventStep.ts
internal/runtime/StepIdentity.ts
internal/runtime/MemoStore.ts
internal/runtime/CheckpointBuffer.ts
internal/runtime/ExecutionSignal.ts
internal/runtime/CommandSink.ts
```

Responsibilities:

- build the existing `HandlerContext` shape;
- assemble the existing `StepTools` object;
- keep `step.run`, async step operations, and `step.sendEvent` in focused modules;
- keep duplicate step ID counting and hashing in one module;
- keep memo lookup and decoding in one module;
- coordinate checkpoint buffering without leaking checkpoint concerns into every step method;
- represent normal SDK yield/planning behavior as typed internal control flow, not defects, once migration risk is understood.

The public `ctx.step` object remains the user-facing API. Any internal `Step` service is an implementation detail, not a new user requirement.

### `internal/client`

Client modules perform Inngest API calls and adapt `HttpClient`.

Possible modules:

```txt
internal/client/EventApi.ts
internal/client/CheckpointApi.ts
internal/client/RegistrationApi.ts
internal/client/InngestHttp.ts
```

Responsibilities:

- isolate outbound event sending, checkpoint API calls, and registration API calls;
- use service/layer patterns instead of hidden test-only hooks;
- keep public `InngestClient` behavior unchanged;
- avoid exposing internal protocol arrays through public service interfaces where possible.

### `internal/codec`

Codec modules replace broad helper dumping grounds for user values, not protocol scalar values.

Possible modules:

```txt
internal/codec/Event.ts
internal/codec/Json.ts
```

Responsibilities:

- event `_tag` injection/stripping policy;
- Schema JSON encode/decode helpers;
- mapping decode/encode failures into existing SDK errors.

Avoid recreating `helpers.ts` under another name. Each codec module should serve one concept.

Do not put Inngest wire scalars such as duration strings or sleep-until timestamps here. Those are protocol concepts and belong in `internal/wire`.

## Current pain points to eliminate gradually

These are architectural targets, not instructions to remove everything in one pass.

- God modules that mix public API types, runtime execution, memoization, protocol encoding, tracing, checkpointing, and IO.
- Protocol modules that combine schemas with runtime factories, time, and domain decisions.
- Test-only hooks implemented by global symbols or runtime mutation of public service classes.
- Normal SDK control flow represented as defects.
- OTel/error attribute logic embedded in protocol-critical step paths when not required for native Inngest parity.
- Generic helper files that accumulate unrelated formatting, encoding, and domain utilities.
- Public modules importing and re-exporting internal implementation details when a stable public type should own the contract.

## Migration strategy

Use a strangler pattern. Each step should reduce one mixed concern while keeping public behavior unchanged.

### 1. Establish the baseline

Before meaningful internal changes, run or record the relevant compatibility checks:

```sh
bun run typecheck
bun run lint
vp test run
```

When full validation is too expensive during iteration, prioritize targeted compatibility checks that cover protocol parity and public behavior.

### 2. Extract low-risk wire scalars and user codecs first

Start by replacing generic helpers with named protocol/user-value modules:

```txt
internal/wire/Duration.ts
internal/wire/Timestamp.ts
internal/codec/Event.ts
internal/codec/Json.ts
```

`internal/wire/Duration.ts` should be a schema-backed Inngest duration scalar, not a free-floating `timeStr` helper. `internal/wire/Timestamp.ts` should own the sleep-until timestamp wire representation. Keep any old helper module as a temporary compatibility facade if that minimizes churn.

### 3. Extract step identity and memo lookup

Move step ID normalization, duplicate counting, hashing, ordering, and memo lookup into focused runtime/domain modules.

This reduces `step.ts` without changing protocol behavior.

### 4. Split protocol schemas from wire encoding

Move schemas and constants into focused `internal/wire` modules. Keep compatibility exports until call sites are migrated.

Introduce an opcode encoder boundary so native protocol quirks are isolated.

### 5. Introduce domain commands beside existing behavior

Model step decisions as domain commands while keeping existing runtime behavior stable. Commands should be introduced as a clarifying layer before becoming the only path.

### 6. Replace defect-based SDK control flow carefully

Once command modeling and driver behavior are well covered, migrate normal step yields/plans/errors to typed internal execution signals. User defects should remain defects.

### 7. Split step operations

Extract `step.run`, async step operations, and `step.sendEvent` into separate runtime modules. `StepTools` becomes an assembler for the existing public shape.

### 8. Move IO behind internal services

Replace direct runtime imports of concrete client implementation with internal services/layers for event, checkpoint, and registration API calls. Public client behavior remains unchanged.

### 9. Remove compatibility facades when empty

Only delete old internal modules once their responsibilities have moved and tests prove no behavior changed.

## Validation philosophy

The existing tests are the contract. New internal tests are useful when they make extraction safer, but they do not replace the gold suite.

Validation should scale by risk:

- wire scalar / codec extraction: targeted unit tests plus typecheck;
- step identity/memo extraction: memo tests and protocol parity tests;
- wire encoding changes: protocol fixture parity and native RED tests;
- driver/control-flow changes: public API contract, native RED tests, checkpoint tests, and parity tests;
- IO service changes: client/public API tests and relevant integration tests.

Never update parity fixtures to match the refactor unless the native SDK reference changed and that change is independently verified.

## Naming conventions

- Use module names that describe one concept: `StepIdentity`, `MemoStore`, `CheckpointBuffer`, `OpcodeEncoder`, `wire/Duration`.
- Use `make` for constructors.
- Use `layer`, `layerConfig`, or `layerX` for layers.
- Use `Service` namespaces/interfaces for `Context.Service` modules.
- Use `Any` for erased model shapes.
- Use `TypeId` when runtime identity matters.
- Prefer domain names over generic names: `StepCommand`, `ExecutionSignal`, `CheckpointBuffer`, not `utils`, `manager`, `handler2`, or `helpers`.
- Keep compatibility names at public boundaries even if internal names improve.

## Design review questions

When adding or moving a module, ask:

1. Does this module have one reason to change?
2. Does it follow an Effect-style `make` / `layer` / `Service` pattern where applicable?
3. Does it avoid IO unless it is a client/adapter module?
4. Does it avoid protocol JSON unless it is a wire module?
5. Does it preserve the current public API without requiring user changes?
6. Can it be tested without running a full HTTP handler?
7. Does it remove knowledge from a god module rather than adding another wrapper around it?
8. Is any ugly native Inngest compatibility behavior isolated in the wire encoder layer?
9. Are temporary compatibility facades clearly temporary?
10. Would a future maintainer know where to add related behavior?

## Desired end state

The end state is not a new user-facing SDK. It is the same SDK from the outside with internals that are easier to reason about:

- public modules remain stable;
- `src/internal/step.ts` no longer acts as a god module;
- protocol schemas and opcode encoding are separated;
- memo, step identity, checkpointing, and event/JSON codecs have focused homes;
- runtime modules coordinate domain commands rather than constructing wire details everywhere;
- IO lives at adapter/client boundaries;
- tests use Effect services/layers rather than hidden public class mutation;
- the existing compatibility suite continues to pass unchanged.
