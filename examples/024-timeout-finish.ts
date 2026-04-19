import { FetchHttpClient } from "effect/unstable/http";
import { BunHttpServer, BunRuntime } from "@effect/platform-bun";
import * as HttpMiddleware from "effect/unstable/http/HttpMiddleware";
import * as HttpServer from "effect/unstable/http/HttpServer";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import { InngestClient, InngestFunction, InngestGroup } from "effect-inngest";

class DemoLongRunning extends Schema.TaggedClass<DemoLongRunning>()("demo/long-running", {}) {}

const LongRunningFn = InngestFunction.make("long-running-task", {
  trigger: { event: DemoLongRunning },
  timeouts: { finish: "2 seconds" },
  success: Schema.Struct({ status: Schema.String }),
});

const Group = InngestGroup.make(LongRunningFn);

const HandlersLive = Group.toLayer({
  "long-running-task": ({ step }) =>
    Effect.gen(function* () {
      yield* step.run("work-1", Effect.succeed("Phase 1 done"));
      yield* step.sleep("long-wait", Duration.seconds(5));
      yield* step.run("work-2", Effect.succeed("Phase 2 done"));
      return { status: "completed" };
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
