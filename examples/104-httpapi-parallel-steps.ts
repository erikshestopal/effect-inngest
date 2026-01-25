import { FetchHttpClient } from "@effect/platform";
import { BunHttpServer, BunRuntime } from "@effect/platform-bun";
import * as HttpMiddleware from "@effect/platform/HttpMiddleware";
import * as HttpServer from "@effect/platform/HttpServer";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import { InngestClient, InngestFunction, InngestGroup } from "effect-inngest";

class DemoParallel extends Schema.TaggedClass<DemoParallel>()("demo/parallel", {
  a: Schema.Number,
  b: Schema.Number,
}) {}

const ParallelFn = InngestFunction.make("parallel-test", {
  trigger: { event: DemoParallel },
  success: Schema.Struct({ sum: Schema.Number, product: Schema.Number }),
});

const Group = InngestGroup.make(ParallelFn);

const HandlersLive = Group.toLayer({
  "parallel-test": ({ event, step }) =>
    Effect.gen(function* () {
      const [sum, product] = yield* Effect.all([
        step.run("sum", Effect.succeed(event.a + event.b)),
        step.run("product", Effect.succeed(event.a * event.b)),
      ]);
      return { sum, product };
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
