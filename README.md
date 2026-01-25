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
import { InngestFunction, InngestGroup, InngestClient } from "effect-inngest";
import { Effect, Schema, Layer } from "effect";

// Define events as TaggedClass
class UserSignup extends Schema.TaggedClass<UserSignup>()("user/signup", {
  userId: Schema.String,
  email: Schema.String,
}) {}

// Create a function — event type is inferred from the trigger
const ProcessSignup = InngestFunction.make("process-signup", {
  trigger: { event: UserSignup },
  success: Schema.Void,
});

// Create group and implement handler
const Group = InngestGroup.make(ProcessSignup);

class UserOnboarded extends Schema.TaggedClass<UserOnboarded>()("user/onboarded", {
  userId: Schema.String,
}) {}

const Handlers = Group.toLayer({
  "process-signup": ({ event, step }) =>
    Effect.gen(function* () {
      // event is typed as UserSignup
      yield* step.run("send-welcome", sendWelcomeEmail(event.email));
      yield* step.sleep("delay", "1 hour");
      yield* step.sendEvent("notify", new UserOnboarded({ userId: event.userId }));
    }),
});
```

<h3><a href="#getting-started">Get started →</a></h3>

---

## Features

- 🧙‍♂️ **Full type inference** — Payload types flow from schemas through triggers to handlers
- ⚡ **Effect-native steps** — `step.run`, `step.sleep`, `step.waitForEvent` return proper Effects
- 🔌 **Dependency injection** — Use Effect's Layer system for services in handlers
- 🛡️ **Schema validation** — Define events once with Effect Schema, validated everywhere
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
import { InngestFunction, InngestGroup, InngestClient } from "effect-inngest";

// 1. Define your events as TaggedClass
class UserSignup extends Schema.TaggedClass<UserSignup>()("user/signup", {
  userId: Schema.String,
  email: Schema.String,
}) {}

class UserWelcomeSent extends Schema.TaggedClass<UserWelcomeSent>()("user/welcome-sent", {
  userId: Schema.String,
}) {}

// 2. Define your functions
const ProcessSignup = InngestFunction.make("process-signup", {
  trigger: { event: UserSignup },
  success: Schema.Struct({ welcomed: Schema.Boolean }),
});

const DailyDigest = InngestFunction.make("daily-digest", {
  trigger: { cron: "0 9 * * *" },
  success: Schema.Void,
});

// 3. Create function group and implement handlers
const App = InngestGroup.make(ProcessSignup, DailyDigest);

const Handlers = App.toLayer({
  "process-signup": ({ event, step }) =>
    Effect.gen(function* () {
      // event is typed as UserSignup
      yield* Effect.log(`Processing signup for ${event.email}`);

      // Durable step - memoized across retries
      const user = yield* step.run("create-user", Effect.succeed({ id: event.userId, email: event.email }));

      // Sleep durably
      yield* step.sleep("welcome-delay", Duration.seconds(5));

      // Send follow-up event
      yield* step.sendEvent("notify", new UserWelcomeSent({ userId: user.id }));

      return { welcomed: true };
    }),

  "daily-digest": ({ step }) => step.run("send-digest", Effect.log("Sending daily digest...")),
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
import { InngestClient, InngestFunction, InngestGroup } from "effect-inngest";

// 1. Define your events
class UserSignup extends Schema.TaggedClass<UserSignup>()("user/signup", {
  userId: Schema.String,
  email: Schema.String,
}) {}

class UserWelcomeSent extends Schema.TaggedClass<UserWelcomeSent>()("user/welcome-sent", {
  userId: Schema.String,
}) {}

// 2. Define functions
const ProcessSignup = InngestFunction.make("process-signup", {
  trigger: { event: UserSignup },
  success: Schema.Struct({ welcomed: Schema.Boolean }),
});

const DailyDigest = InngestFunction.make("daily-digest", {
  trigger: { cron: "0 9 * * *" },
  success: Schema.Void,
});

// 3. Create group and handlers
const App = InngestGroup.make(ProcessSignup, DailyDigest);

const Handlers = App.toLayer({
  "process-signup": ({ event, step }) =>
    Effect.gen(function* () {
      yield* Effect.log(`Processing signup for ${event.email}`);
      const user = yield* step.run("create-user", Effect.succeed({ id: event.userId, email: event.email }));
      yield* step.sleep("welcome-delay", Duration.seconds(5));
      yield* step.sendEvent("notify", new UserWelcomeSent({ userId: user.id }));
      return { welcomed: true };
    }),
  "daily-digest": ({ step }) => step.run("send-digest", Effect.log("Sending daily digest...")),
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

### 1. Define your events as TaggedClass

```typescript
import { Schema } from "effect";

class UserSignup extends Schema.TaggedClass<UserSignup>()("user/signup", {
  userId: Schema.String,
  email: Schema.String,
  plan: Schema.Literal("free", "pro", "enterprise"),
}) {}

class OrderPlaced extends Schema.TaggedClass<OrderPlaced>()("order/placed", {
  orderId: Schema.String,
  items: Schema.Array(Schema.Struct({ sku: Schema.String, qty: Schema.Number })),
  total: Schema.Number,
}) {}
```

### 2. Define your functions

```typescript
import { InngestFunction } from "effect-inngest";

// Event-triggered function
const ProcessSignup = InngestFunction.make("process-signup", {
  trigger: [{ event: UserSignup }], // pass multiple triggers as Array.
  success: Schema.Struct({ welcomeEmailSent: Schema.Boolean }),
});

// Cron-triggered function
const DailyReport = InngestFunction.make("daily-report", {
  trigger: { cron: "0 9 * * *" },
  success: Schema.Void,
});
```

### 3. Create a function group and implement handlers

```typescript
import { InngestGroup } from "effect-inngest";
import { Effect, Duration } from "effect";

const AppFunctions = InngestGroup.make(ProcessSignup, DailyReport);

const HandlersLive = AppFunctions.toLayer({
  "process-signup": ({ event, step }) =>
    Effect.gen(function* () {
      yield* step.run("create-user", createUser(event));
      yield* step.sleep("delay", Duration.minutes(5));
      yield* step.sendEvent("welcome", new UserWelcomeSent({ userId: event.userId }));
      return { welcomeEmailSent: true };
    }),

  "daily-report": ({ step }) => step.run("generate", Effect.log("Generating report...")),
});
```

### 4. Create a web handler

```typescript
import { InngestClient, InngestGroup } from "effect-inngest";
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
({ step }) =>
  Effect.gen(function* () {
    // Run any Effect with memoization
    const user = yield* step.run("fetch-user", fetchUser(userId));

    // Sleep for a duration
    yield* step.sleep("wait", Duration.hours(24));

    // Sleep until a timestamp
    yield* step.sleepUntil("deadline", new Date("2024-12-31"));

    // Wait for an event (returns Option)
    const payment = yield* step.waitForEvent("await-payment", PaymentReceived, {
      timeout: Duration.days(7),
      if: `async.data.orderId == "${orderId}"`,
    });

    // Invoke another function
    const result = yield* step.invoke("process", {
      function: ProcessOrder,
      data: { orderId: "123" },
    });

    // Send events
    yield* step.sendEvent("notify", new OrderShipped({ orderId }));
  });
```

### Parallel Execution

Run steps in parallel with Effect's concurrency:

```typescript
const [user, orders, prefs] =
  yield *
  Effect.all(
    [step.run("user", fetchUser(id)), step.run("orders", fetchOrders(id)), step.run("prefs", fetchPreferences(id))],
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
  "process-signup": ({ event, step }) =>
    Effect.gen(function* () {
      const email = yield* EmailService;
      yield* step.run("send", email.send(event.email, "Welcome!"));
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
  cancelOn: [{ event: "order/cancelled", if: "event.data.orderId == async.data.orderId" }],
  priority: { run: "event.data.isPremium ? 100 : 0" },
});
```

---

## Error Handling

Control retry behavior with typed errors:

```typescript
import { NonRetriableError, RetryAfterError } from "effect-inngest";

// Don't retry this error
yield * new NonRetriableError({ message: "Card permanently declined" });

// Retry after a specific duration (retryAfter in milliseconds)
yield * new RetryAfterError({ message: "Rate limited", retryAfter: 60000 });
```

---

## API Reference

### Core Modules

| Module              | Description                                            |
| ------------------- | ------------------------------------------------------ |
| `InngestFunction`   | Function definition with trigger-based event inference |
| `InngestGroup`      | Group functions, create handlers, and serve HTTP       |
| `InngestClient`     | Client configuration and event operations              |
| `NonRetriableError` | Error to skip retries                                  |
| `RetryAfterError`   | Error to retry after delay                             |

### Step Methods

| Method                                     | Description                        |
| ------------------------------------------ | ---------------------------------- |
| `step.run(id, effect)`                     | Execute an effect with memoization |
| `step.sleep(id, duration)`                 | Sleep for a duration               |
| `step.sleepUntil(id, timestamp)`           | Sleep until a timestamp            |
| `step.waitForEvent(id, EventSchema, opts)` | Wait for an event with timeout     |
| `step.invoke(id, opts)`                    | Invoke another function            |
| `step.sendEvent(id, TaggedEvent)`          | Send events to Inngest             |

---

## Examples

See the [`examples/`](./examples) directory:

---

## Current Limitations

This library is under active development. The following Inngest features are **not yet supported**:

| Feature                | Status               |
| ---------------------- | -------------------- |
| Middleware             | 🚧 Not yet supported |
| AI Steps (`step.ai.*`) | 🚧 Not yet supported |
| Encryption             | 🚧 Not yet supported |

---

## License

MIT
