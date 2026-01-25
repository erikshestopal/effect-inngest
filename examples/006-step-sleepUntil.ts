import { FetchHttpClient } from "@effect/platform";
import { BunHttpServer, BunRuntime } from "@effect/platform-bun";
import * as HttpMiddleware from "@effect/platform/HttpMiddleware";
import * as HttpServer from "@effect/platform/HttpServer";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import { InngestClient, InngestFunction, InngestGroup } from "effect-inngest";

class DemoSleepUntil extends Schema.TaggedClass<DemoSleepUntil>()("demo/sleep-until", {}) {}

const SleepUntilFn = InngestFunction.make("sleep-until", {
  trigger: { event: DemoSleepUntil },
  success: Schema.Struct({ wokeAt: Schema.String }),
});

const Group = InngestGroup.make(SleepUntilFn);

const HandlersLive = Group.toLayer({
  "sleep-until": ({ step }) =>
    Effect.gen(function* () {
      const target = new Date(Date.now() + 5000);
      yield* step.sleepUntil("wait-until", target);
      return { wokeAt: new Date().toISOString() };
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
