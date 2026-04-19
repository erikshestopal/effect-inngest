import { FetchHttpClient } from "effect/unstable/http";
import { BunHttpServer, BunRuntime } from "@effect/platform-bun";
import * as HttpMiddleware from "effect/unstable/http/HttpMiddleware";
import * as HttpServer from "effect/unstable/http/HttpServer";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import { InngestClient, InngestFunction, InngestGroup } from "effect-inngest";

class DemoSendSingle extends Schema.TaggedClass<DemoSendSingle>()("demo/send-single", {
  userId: Schema.String,
}) {}

class DemoNotification extends Schema.TaggedClass<DemoNotification>()("demo/notification", {
  userId: Schema.String,
  message: Schema.String,
}) {}

const SendSingleFn = InngestFunction.make("send-single", {
  trigger: { event: DemoSendSingle },
  success: Schema.Struct({ sent: Schema.Boolean }),
});

const Group = InngestGroup.make(SendSingleFn);

const HandlersLive = Group.toLayer({
  "send-single": ({ event, step }) =>
    Effect.gen(function* () {
      yield* step.sendEvent(
        "send-notification",
        new DemoNotification({ userId: event.userId, message: "Hello from step.sendEvent!" }),
      );
      return { sent: true };
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
