import { FetchHttpClient } from "effect/unstable/http";
import { BunHttpServer, BunRuntime } from "@effect/platform-bun";
import * as HttpMiddleware from "effect/unstable/http/HttpMiddleware";
import * as HttpServer from "effect/unstable/http/HttpServer";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import { InngestClient, InngestFunction, InngestGroup } from "effect-inngest";

class DemoParallelMixed extends Schema.TaggedClass<DemoParallelMixed>()("demo/parallel-mixed", {}) {}

class DemoSideEffect extends Schema.TaggedClass<DemoSideEffect>()("demo/side-effect", {
  source: Schema.String,
}) {}

const ParallelMixedFn = InngestFunction.make("parallel-mixed", {
  trigger: { event: DemoParallelMixed },
  success: Schema.Struct({ computed: Schema.Number, slept: Schema.Boolean, sent: Schema.Boolean }),
});

const Group = InngestGroup.make(ParallelMixedFn);

const HandlersLive = Group.toLayer({
  "parallel-mixed": ({ step }) =>
    Effect.gen(function* () {
      yield* Effect.log("Starting parallel mixed steps...");

      const [computed, _sleptResult, _sentResult] = yield* Effect.all([
        step.run("compute", Effect.succeed(42)),

        step.sleep("short-wait", Duration.seconds(2)),

        step.sendEvent("notify", new DemoSideEffect({ source: "parallel-mixed-function" })),
      ]);

      yield* Effect.log(`Parallel steps complete! Computed: ${computed}`);
      return { computed, slept: true, sent: true };
    }),
});

const ClientLive = InngestClient.layer({
  id: "research-app",
  mode: "dev",
  apiBaseUrl: "http://127.0.0.1:8288",
  eventKey: "test",
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
