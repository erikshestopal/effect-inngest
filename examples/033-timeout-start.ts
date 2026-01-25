import { FetchHttpClient } from "@effect/platform";
import { BunHttpServer, BunRuntime } from "@effect/platform-bun";
import * as HttpMiddleware from "@effect/platform/HttpMiddleware";
import * as HttpServer from "@effect/platform/HttpServer";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import { InngestClient, InngestFunction, InngestGroup } from "effect-inngest";

class DemoSlowStart extends Schema.TaggedClass<DemoSlowStart>()("demo/slow-start", {}) {}

const SlowStartFn = InngestFunction.make("slow-start-task", {
  trigger: { event: DemoSlowStart },
  timeouts: { start: "10 seconds" },
  success: Schema.Struct({ status: Schema.String }),
});

const Group = InngestGroup.make(SlowStartFn);

const HandlersLive = Group.toLayer({
  "slow-start-task": ({ step }) =>
    Effect.gen(function* () {
      yield* step.run("quick-work", Effect.succeed("Started successfully"));
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
