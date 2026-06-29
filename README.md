<div align="center">
  <br />
  <img src="./logo.png" alt="Effect Inngest" width="180" />
  <h1>Effect Inngest</h1>
  <p><strong>Build durable, type-safe workflows with Effect and Inngest</strong></p>
  <p>The native Effect SDK for <a href="https://inngest.com">Inngest</a> — full type inference, composable steps, and dependency injection.</p>
  <br />

<a href="#getting-started">Getting Started</a>
<span>&nbsp;&nbsp;•&nbsp;&nbsp;</span>
<a href="#features">Features</a>
<span>&nbsp;&nbsp;•&nbsp;&nbsp;</span>
<a href="#api-reference">API Reference</a>
<span>&nbsp;&nbsp;•&nbsp;&nbsp;</span>
<a href="./examples">Examples</a>
<br />
<br />

</div>

---

## What is Effect Inngest?

Effect Inngest brings the power of [Effect](https://effect.website) to [Inngest's](https://inngest.com) durable execution platform. Define event schemas once, and types flow automatically through triggers, handlers, and step operations — no manual annotations needed.

```typescript
import { InngestClient, InngestEvent, InngestFunction, InngestGroup, Inngest } from "effect-inngest";
import { Effect, Schema, Layer } from "effect";

const UserSignup = InngestEvent.make(
  "user/signup",
  Schema.Struct({
    userId: Schema.String,
    email: Schema.String,
  }),
);

// Create a function — event type is inferred from the trigger
const ProcessSignup = InngestFunction.make("process-signup", {
  trigger: { event: UserSignup },
});

// Create group and implement handler
const Group = InngestGroup.make(ProcessSignup);

const UserOnboarded = InngestEvent.make("user/onboarded", Schema.Struct({ userId: Schema.String }));

const Handlers = Group.toLayer({
  "process-signup": ({ event }) =>
    Effect.gen(function* () {
      // event is typed as { name: "user/signup", data: { userId, email } }
      yield* Inngest.run("send-welcome", sendWelcomeEmail(event.data.email));
      yield* Inngest.sleep("delay", "1 hour");
      yield* Inngest.sendEvent("notify", UserOnboarded.make({ userId: event.data.userId }));
    }),
});
```

<h3><a href="#getting-started">Get started →</a></h3>

---

## Features

- 🧙‍♂️ **Full type inference** — Payload types flow from schemas through triggers to handlers
- ⚡ **Effect-native steps** — `Inngest.run`, `Inngest.sleep`, `Inngest.waitForEvent` return proper Effects
- 🔌 **Dependency injection** — Use Effect's Layer system for services in handlers
- 🛡️ **Event validation** — Define events once with Effect Schema, validated at the boundary
- 🚀 **Zero boilerplate** — No code generation, no manual type annotations
- 🔄 **Parallel execution** — Run steps concurrently with `Effect.all`
- 🌐 **Multi-runtime** — Works with Bun, Node.js, and Cloudflare Workers
- 🪶 **Lightweight** — Minimal dependencies, tree-shakeable

---

## Installation

```bash
npm install effect-inngest effect @effect/platform
```

<details>
<summary>Other package managers</summary>

```bash
# pnpm
pnpm add effect-inngest effect @effect/platform

# yarn
yarn add effect-inngest effect @effect/platform

# bun
bun add effect-inngest effect @effect/platform
```

</details>

---

## Quick Start

Copy this into a file called `inngest-demo.ts` and run it:

```typescript
import { FetchHttpClient } from "@effect/platform";
import { BunHttpServer, BunRuntime } from "@effect/platform-bun";
import * as HttpMiddleware from "@effect/platform/HttpMiddleware";
import * as HttpServer from "@effect/platform/HttpServer";
import { Duration, Effect, Layer, Schema } from "effect";
import { InngestClient, InngestEvent, InngestFunction, InngestGroup, Inngest } from "effect-inngest";

// 1. Define your Inngest event definitions
const UserSignup = InngestEvent.make(
  "user/signup",
  Schema.Struct({
    userId: Schema.String,
    email: Schema.String,
  }),
);

const UserWelcomeSent = InngestEvent.make("user/welcome-sent", Schema.Struct({ userId: Schema.String }));

// 2. Define your functions
const ProcessSignup = InngestFunction.make("process-signup", {
  trigger: { event: UserSignup },
});

const DailyDigest = InngestFunction.make("daily-digest", {
  trigger: { cron: "0 9 * * *" },
});

// 3. Create function group and implement handlers
const App = InngestGroup.make(ProcessSignup, DailyDigest);

const Handlers = App.toLayer({
  "process-signup": ({ event }) =>
    Effect.gen(function* () {
      // event is typed as { name: "user/signup", data: { userId, email } }
      yield* Effect.log(`Processing signup for ${event.data.email}`);

      // Durable value-returning steps are normalized through JSON on the wire
      const user = yield* Inngest.run(
        "create-user",
        Effect.succeed({ id: event.data.userId, email: event.data.email }),
      );

      // Sleep durably
      yield* Inngest.sleep("welcome-delay", Duration.seconds(5));

      // Send follow-up event
      yield* Inngest.sendEvent("notify", UserWelcomeSent.make({ userId: user.id }));

      return { welcomed: true };
    }),

  "daily-digest": () => Inngest.run("send-digest", Effect.log("Sending daily digest...")),
});

// 4. Create client and start server
const Client = InngestClient.layer({
  id: "my-app",
  mode: "dev",
}).pipe(Layer.provide(FetchHttpClient.layer));

const Server = HttpServer.serve(InngestGroup.toHttpApp(App), HttpMiddleware.logger).pipe(
  HttpServer.withLogAddress,
  Layer.provide(BunHttpServer.layer({ port: 3000 })),
  Layer.provide(Handlers),
  Layer.provide(Client),
  Layer.provide(FetchHttpClient.layer),
);

// Run it
BunRuntime.runMain(Layer.launch(Server));
```

Then in two terminals:

```bash
# Terminal 1: Start your app
bun inngest-demo.ts

# Terminal 2: Start Inngest dev server
bunx inngest-cli@latest dev -u http://localhost:3000
```

Open http://localhost:8288 to trigger events and watch your functions run.

### Using HttpApiBuilder

For more complex applications, you can compose Inngest into an existing `HttpApi`:

```typescript
import * as HttpApi from "@effect/platform/HttpApi";
import * as HttpApiBuilder from "@effect/platform/HttpApiBuilder";
import { FetchHttpClient } from "@effect/platform";
import { BunHttpServer, BunRuntime } from "@effect/platform-bun";
import { Duration, Effect, Layer, Schema } from "effect";
import { InngestApiGroup, layerGroup } from "effect-inngest/HttpApi";
import { InngestClient, InngestEvent, InngestFunction, InngestGroup, Inngest } from "effect-inngest";

// 1. Define your events
const UserSignup = InngestEvent.make(
  "user/signup",
  Schema.Struct({
    userId: Schema.String,
    email: Schema.String,
  }),
);

const UserWelcomeSent = InngestEvent.make("user/welcome-sent", Schema.Struct({ userId: Schema.String }));

// 2. Define functions
const ProcessSignup = InngestFunction.make("process-signup", {
  trigger: { event: UserSignup },
});

const DailyDigest = InngestFunction.make("daily-digest", {
  trigger: { cron: "0 9 * * *" },
});

// 3. Create group and handlers
const App = InngestGroup.make(ProcessSignup, DailyDigest);

const Handlers = App.toLayer({
  "process-signup": ({ event }) =>
    Effect.gen(function* () {
      yield* Effect.log(`Processing signup for ${event.data.email}`);
      const user = yield* Inngest.run(
        "create-user",
        Effect.succeed({ id: event.data.userId, email: event.data.email }),
      );
      yield* Inngest.sleep("welcome-delay", Duration.seconds(5));
      yield* Inngest.sendEvent("notify", UserWelcomeSent.make({ userId: user.id }));
      return { welcomed: true };
    }),
  "daily-digest": () => Inngest.run("send-digest", Effect.log("Sending daily digest...")),
});

// 4. Create client
const Client = InngestClient.layer({
  id: "my-app",
  mode: "dev",
}).pipe(Layer.provide(FetchHttpClient.layer));

// 5. Create API with Inngest group at /inngest prefix
const MyApi = HttpApi.make("my-api").add(InngestApiGroup.prefix("/inngest"));

// 6. Build API layer
const ApiLive = HttpApiBuilder.api(MyApi).pipe(
  Layer.provide(layerGroup(MyApi, App)),
  Layer.provide(Handlers),
  Layer.provide(Client),
  Layer.provide(FetchHttpClient.layer),
);

// 7. Serve
const Server = HttpApiBuilder.serve().pipe(Layer.provide(ApiLive), Layer.provide(BunHttpServer.layer({ port: 3000 })));

BunRuntime.runMain(Layer.launch(Server));
```

---

## Getting Started

### 1. Define your events

```typescript
import { Schema } from "effect";
import { InngestEvent } from "effect-inngest";

const UserSignup = InngestEvent.make(
  "user/signup",
  Schema.Struct({
    userId: Schema.String,
    email: Schema.String,
    plan: Schema.Literal("free", "pro", "enterprise"),
  }),
);

const OrderPlaced = InngestEvent.make(
  "order/placed",
  Schema.Struct({
    orderId: Schema.String,
    items: Schema.Array(Schema.Struct({ sku: Schema.String, qty: Schema.Number })),
    total: Schema.Number,
  }),
);

const UserWelcomeSent = InngestEvent.make("user/welcome-sent", Schema.Struct({ userId: Schema.String }));
```

### 2. Define your functions

```typescript
import { InngestFunction } from "effect-inngest";

// Event-triggered function
const ProcessSignup = InngestFunction.make("process-signup", {
  trigger: [{ event: UserSignup }], // pass multiple triggers as Array.
});

// Cron-triggered function
const DailyReport = InngestFunction.make("daily-report", {
  trigger: { cron: "0 9 * * *" },
});
```

### 3. Create a function group and implement handlers

```typescript
import { InngestGroup, Inngest } from "effect-inngest";
import { Effect, Duration } from "effect";

const AppFunctions = InngestGroup.make(ProcessSignup, DailyReport);

const HandlersLive = AppFunctions.toLayer({
  "process-signup": ({ event }) =>
    Effect.gen(function* () {
      yield* Inngest.run("create-user", createUser(event));
      yield* Inngest.sleep("delay", Duration.minutes(5));
      yield* Inngest.sendEvent("welcome", UserWelcomeSent.make({ userId: event.data.userId }));
      return { welcomeEmailSent: true };
    }),

  "daily-report": () => Inngest.run("generate", Effect.log("Generating report...")),
});
```

### 4. Create a web handler

```typescript
import { InngestClient, InngestGroup, Inngest } from "effect-inngest";
import { FetchHttpClient } from "@effect/platform";
import { Layer } from "effect";

const ClientLive = InngestClient.layer({
  id: "my-app",
  mode: "cloud",
  signingKey: process.env.INNGEST_SIGNING_KEY,
  eventKey: process.env.INNGEST_EVENT_KEY,
}).pipe(Layer.provide(FetchHttpClient.layer));

const { handler, dispose } = InngestGroup.toWebHandler(AppFunctions, {
  layer: Layer.mergeAll(HandlersLive, ClientLive),
});

// Use with Bun
Bun.serve({ port: 3000, fetch: handler });
```

---

## Step Operations

All step operations are durable — they're memoized and survive retries:

```typescript
() =>
  Effect.gen(function* () {
    // Run an Effect with memoization. Values are replayed as normalized JSON.
    const user = yield* Inngest.run("fetch-user", fetchUser(userId));

    // Sleep for a duration
    yield* Inngest.sleep("wait", Duration.hours(24));

    // Sleep until a timestamp
    yield* Inngest.sleepUntil("deadline", new Date("2024-12-31"));

    // Wait for an event (returns Option)
    const payment = yield* Inngest.waitForEvent("await-payment", PaymentReceived, {
      timeout: Duration.days(7),
      if: `async.data.orderId == "${orderId}"`,
    });

    // Invoke another function
    const result = yield* Inngest.invoke("process", {
      function: ProcessOrder,
      data: OrderPlaced.make({ orderId: "123", items: [], total: 0 }),
    });

    // Send events
    yield* Inngest.sendEvent("notify", OrderShipped.make({ orderId }));
  });
```

### Parallel Execution

Run steps in parallel with Effect's concurrency:

```typescript
const [user, orders, prefs] =
  yield *
  Effect.all(
    [
      Inngest.run("user", fetchUser(id)),
      Inngest.run("orders", fetchOrders(id)),
      Inngest.run("prefs", fetchPreferences(id)),
    ],
    { concurrency: "unbounded" },
  );
```

---

## Dependency Injection

Use Effect's Layer system for clean dependency injection:

```typescript
import { Context, Layer } from "effect";

// Define a service
class EmailService extends Context.Tag("EmailService")<
  EmailService,
  { readonly send: (to: string, body: string) => Effect.Effect<void> }
>() {}

// Use in handler
const HandlersLive = AppFunctions.toLayer({
  "process-signup": ({ event }) =>
    Effect.gen(function* () {
      const email = yield* EmailService;
      yield* Inngest.run("send", email.send(event.data.email, "Welcome!"));
      return { welcomeEmailSent: true };
    }),
});

// Provide implementation
const EmailServiceLive = Layer.succeed(EmailService, {
  send: (to, body) => Effect.log(`Sending to ${to}: ${body}`),
});

const { handler } = InngestGroup.toWebHandler(AppFunctions, {
  layer: Layer.mergeAll(HandlersLive.pipe(Layer.provide(EmailServiceLive)), ClientLive),
});
```

---

## Function Options

Configure retries, concurrency, rate limiting, and more:

```typescript
const ProcessOrder = InngestFunction.make("process-order", {
  trigger: { event: OrderPlaced },
  retries: 5,
  concurrency: { limit: 10, key: "event.data.userId" },
  rateLimit: { limit: 100, period: Duration.minutes(1) },
  throttle: { limit: 50, period: Duration.seconds(10) },
  debounce: { period: Duration.seconds(5) },
  idempotency: "event.data.orderId",
  timeouts: { finish: Duration.hours(1) },
  cancelOn: [{ event: OrderCancelled, if: "event.data.orderId == async.data.orderId" }],
  priority: { run: "event.data.isPremium ? 100 : 0" },
});
```

---

## Error Handling

Control retry behavior with typed errors:

```typescript
import { Duration, Effect } from "effect";
import { NonRetriableError, RetryAfterError } from "effect-inngest";

// Don't retry this error
yield * Effect.fail(NonRetriableError.make({ message: "Card permanently declined" }));

// Retry after a specific duration
yield * Effect.fail(RetryAfterError.make({ message: "Rate limited", retryAfter: Duration.seconds(30) }));
```

---

## API Reference

### Core Modules

| Module              | Description                                            |
| ------------------- | ------------------------------------------------------ |
| `InngestFunction`   | Function definition with trigger-based event inference |
| `InngestGroup`      | Group functions, create handlers, and serve HTTP       |
| `InngestClient`     | Client configuration and event operations              |
| `InngestEvent`      | Event schema constructor with typed `.make` envelopes  |
| `NonRetriableError` | Error to skip retries                                  |
| `RetryAfterError`   | Error to retry after delay                             |

### Step Methods

| Method                                              | Description                        |
| --------------------------------------------------- | ---------------------------------- |
| `Inngest.run(id, effect)`                           | Execute an Effect with memoization |
| `Inngest.sleep(id, duration)`                       | Sleep for a duration               |
| `Inngest.sleepUntil(id, timestamp)`                 | Sleep until a timestamp            |
| `Inngest.waitForEvent(id, InngestEvent, opts)`      | Wait for an event with timeout     |
| `Inngest.invoke(id, opts)`                          | Invoke another function            |
| `Inngest.sendEvent(id, InngestEvent.make(payload))` | Send events to Inngest             |

---

## Examples

See the [`examples/`](./examples) directory:

---

## Current Limitations

This library is under active development. The following Inngest features are **not yet supported**:

| Feature                   | Status               |
| ------------------------- | -------------------- |
| Middleware                | 🚧 Not yet supported |
| AI Steps (`Inngest.ai.*`) | 🚧 Not yet supported |
| Encryption                | 🚧 Not yet supported |

---

## License

MIT
