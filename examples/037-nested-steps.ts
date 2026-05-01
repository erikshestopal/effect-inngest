import { FetchHttpClient } from "effect/unstable/http";
import { BunHttpServer, BunRuntime } from "@effect/platform-bun";
import * as HttpMiddleware from "effect/unstable/http/HttpMiddleware";
import * as HttpServer from "effect/unstable/http/HttpServer";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import { InngestClient, InngestFunction, InngestGroup } from "effect-inngest";

class DemoNested extends Schema.TaggedClass<DemoNested>()("demo/nested", {}) {}

const NestedStepsFn = InngestFunction.make("nested-steps-demo", {
  trigger: { event: DemoNested },
  success: Schema.Struct({
    level1: Schema.Number,
    level2: Schema.Number,
    level3: Schema.Number,
    final: Schema.Number,
  }),
});

const Group = InngestGroup.make(NestedStepsFn);

const HandlersLive = Group.toLayer({
  "nested-steps-demo": ({ step }) =>
    Effect.gen(function* () {
      const level1 = yield* step.run("level-1", Effect.succeed(10));

      const level2 = yield* step.run("level-2", Effect.succeed(level1 * 2));

      const level3 = yield* step.run("level-3", Effect.succeed(level2 + 5));

      const final = yield* step.run("final-computation", Effect.succeed(level1 + level2 + level3));

      return { level1, level2, level3, final };
    }),
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
