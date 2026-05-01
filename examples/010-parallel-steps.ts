import { FetchHttpClient } from "effect/unstable/http";
import { BunHttpServer, BunRuntime } from "@effect/platform-bun";
import * as HttpMiddleware from "effect/unstable/http/HttpMiddleware";
import * as HttpServer from "effect/unstable/http/HttpServer";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import { InngestClient, InngestFunction, InngestGroup } from "effect-inngest";

class DemoParallel extends Schema.TaggedClass<DemoParallel>()("demo/parallel", {}) {}

const ParallelFn = InngestFunction.make("parallel-steps", {
  trigger: { event: DemoParallel },
  success: Schema.Struct({ results: Schema.Array(Schema.Number) }),
});

const Group = InngestGroup.make(ParallelFn);

const HandlersLive = Group.toLayer({
  "parallel-steps": ({ step }) =>
    Effect.gen(function* () {
      const results = yield* Effect.all([
        step.run("step-1", Effect.succeed(1)),
        step.run("step-2", Effect.succeed(2)),
        step.run("step-3", Effect.succeed(3)),
      ]);
      return { results };
    }),
});

const ClientLive = InngestClient.layer({
  id: "research-app",
  mode: "dev",
  apiBaseUrl: "http://127.0.0.1:8288",
  eventBaseUrl: "http://127.0.0.1:8288",
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
