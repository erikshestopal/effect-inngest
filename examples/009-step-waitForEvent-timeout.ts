import { FetchHttpClient } from "@effect/platform";
import { BunHttpServer, BunRuntime } from "@effect/platform-bun";
import * as HttpMiddleware from "@effect/platform/HttpMiddleware";
import * as HttpServer from "@effect/platform/HttpServer";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { InngestClient, InngestFunction, InngestGroup } from "effect-inngest";

class DemoWaitTimeout extends Schema.TaggedClass<DemoWaitTimeout>()("demo/wait-timeout", {
  orderId: Schema.String,
}) {}

class DemoTimeoutSignal extends Schema.TaggedClass<DemoTimeoutSignal>()("demo/timeout-signal", {
  orderId: Schema.String,
}) {}

const WaitTimeoutFn = InngestFunction.make("wait-timeout", {
  trigger: { event: DemoWaitTimeout },
  success: Schema.Struct({ timedOut: Schema.Boolean }),
});

const Group = InngestGroup.make(WaitTimeoutFn);

const HandlersLive = Group.toLayer({
  "wait-timeout": ({ event, step }) =>
    Effect.gen(function* () {
      const eventOption = yield* step.waitForEvent("wait-for-signal", DemoTimeoutSignal, {
        timeout: Duration.seconds(5),
        if: `async.data.orderId == "${event.orderId}"`,
      });
      return { timedOut: Option.isNone(eventOption) };
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
