import { FetchHttpClient } from "effect/unstable/http";
import { BunHttpServer, BunRuntime } from "@effect/platform-bun";
import * as HttpMiddleware from "effect/unstable/http/HttpMiddleware";
import * as HttpServer from "effect/unstable/http/HttpServer";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import { InngestClient, InngestFunction, InngestGroup } from "effect-inngest";

class DemoStepSingle extends Schema.TaggedClass<DemoStepSingle>()("demo/step-single", {
  value: Schema.Number,
}) {}

const StepSingleFn = InngestFunction.make("step-single", {
  trigger: { event: DemoStepSingle },
  success: Schema.Struct({ doubled: Schema.Number }),
});

const Group = InngestGroup.make(StepSingleFn);

const HandlersLive = Group.toLayer({
  "step-single": ({ event, step }) =>
    Effect.gen(function* () {
      yield* Effect.log(`step-single input: ${event.value}`);
      const doubled = yield* step.run(
        "double",
        Effect.gen(function* () {
          yield* Effect.log(`doubling ${event.value}`);
          return event.value * 2;
        }),
      );
      yield* Effect.log(`step-single doubled: ${doubled}`);
      return { doubled };
    }).pipe(Effect.withSpan("example/step-single")),
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
