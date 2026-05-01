import { FetchHttpClient } from "effect/unstable/http";
import { BunHttpServer, BunRuntime } from "@effect/platform-bun";
import * as HttpMiddleware from "effect/unstable/http/HttpMiddleware";
import * as HttpServer from "effect/unstable/http/HttpServer";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import { InngestClient, InngestFunction, InngestGroup } from "effect-inngest";

class DemoMemoized extends Schema.TaggedClass<DemoMemoized>()("demo/memoized", {}) {}

const MemoizedFn = InngestFunction.make("memoization-demo", {
  trigger: { event: DemoMemoized },
  success: Schema.Struct({
    timestamp: Schema.Number,
    randomValue: Schema.Number,
  }),
});

const Group = InngestGroup.make(MemoizedFn);

const HandlersLive = Group.toLayer({
  "memoization-demo": ({ step }) =>
    Effect.gen(function* () {
      const timestamp = yield* step.run("capture-time", Effect.succeed(Date.now()));
      const randomValue = yield* step.run("capture-random", Effect.succeed(Math.random()));

      yield* step.sleep("checkpoint", Duration.seconds(1));

      yield* step.run(
        "verify",
        Effect.sync(() => console.log(`Timestamp: ${timestamp}, Random: ${randomValue}`)),
      );

      return { timestamp, randomValue };
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
