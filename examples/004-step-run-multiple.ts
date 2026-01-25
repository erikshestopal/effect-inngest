import { FetchHttpClient } from "@effect/platform";
import { BunHttpServer, BunRuntime } from "@effect/platform-bun";
import * as HttpMiddleware from "@effect/platform/HttpMiddleware";
import * as HttpServer from "@effect/platform/HttpServer";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import { InngestClient, InngestFunction, InngestGroup } from "effect-inngest";

class DemoStepChain extends Schema.TaggedClass<DemoStepChain>()("demo/step-chain", {
  value: Schema.Number,
}) {}

const StepChainFn = InngestFunction.make("step-chain", {
  trigger: { event: DemoStepChain },
  success: Schema.Struct({ result: Schema.Number }),
});

const Group = InngestGroup.make(StepChainFn);

const HandlersLive = Group.toLayer({
  "step-chain": ({ event, step }) =>
    Effect.gen(function* () {
      yield* Effect.log(`step-chain input: ${event.value}`);
      const doubled = yield* step.run(
        "double",
        Effect.gen(function* () {
          yield* Effect.log(`doubling ${event.value}`);
          return event.value * 2;
        }),
      );
      const result = yield* step.run(
        "add-ten",
        Effect.gen(function* () {
          yield* Effect.log(`adding 10 to ${doubled}`);
          return doubled + 10;
        }),
      );
      yield* Effect.log(`step-chain result: ${result}`);
      return { result };
    }).pipe(Effect.withSpan("example/step-chain")),
});

const ClientLive = InngestClient.layer({
  id: "research-app",
  mode: "dev",
  apiBaseUrl: "http://127.0.0.1:8288",
}).pipe(Layer.provide(FetchHttpClient.layer));

HttpServer.serve(InngestGroup.toHttpApp(Group), HttpMiddleware.logger).pipe(
  HttpServer.withLogAddress,
  Layer.provide(BunHttpServer.layer({ port: 9999, hostname: "0.0.0.0" })),
  Layer.provide(HandlersLive),
  Layer.provide(ClientLive),
  Layer.provide(FetchHttpClient.layer),
  Layer.launch,
  BunRuntime.runMain,
);
