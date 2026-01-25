import { FetchHttpClient } from "@effect/platform";
import { BunHttpServer, BunRuntime } from "@effect/platform-bun";
import * as HttpMiddleware from "@effect/platform/HttpMiddleware";
import * as HttpServer from "@effect/platform/HttpServer";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import { InngestClient, InngestFunction, InngestGroup } from "effect-inngest";

class DemoSleep extends Schema.TaggedClass<DemoSleep>()("demo/sleep", {}) {}

const SleepFn = InngestFunction.make("sleep-test", {
  trigger: { event: DemoSleep },
  success: Schema.Struct({ slept: Schema.Boolean }),
});

const Group = InngestGroup.make(SleepFn);

const HandlersLive = Group.toLayer({
  "sleep-test": ({ step }) =>
    Effect.gen(function* () {
      yield* step.sleep("wait", Duration.seconds(1));
      return { slept: true };
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
