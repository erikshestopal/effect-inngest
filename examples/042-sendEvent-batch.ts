import { FetchHttpClient } from "@effect/platform";
import { BunHttpServer, BunRuntime } from "@effect/platform-bun";
import * as HttpMiddleware from "@effect/platform/HttpMiddleware";
import * as HttpServer from "@effect/platform/HttpServer";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import { InngestClient, InngestFunction, InngestGroup } from "effect-inngest";

class DemoSendBatch extends Schema.TaggedClass<DemoSendBatch>()("demo/send-batch", {}) {}

class DemoNotification extends Schema.TaggedClass<DemoNotification>()("demo/notification", {
  userId: Schema.String,
  message: Schema.String,
}) {}

const SendBatchFn = InngestFunction.make("send-batch", {
  trigger: { event: DemoSendBatch },
  success: Schema.Struct({ sentCount: Schema.Number }),
});

const Group = InngestGroup.make(SendBatchFn);

const HandlersLive = Group.toLayer({
  "send-batch": ({ step }) =>
    Effect.gen(function* () {
      yield* Effect.log("Sending batch of notifications...");

      yield* step.sendEvent("send-notifications", [
        new DemoNotification({ userId: "u1", message: "First notification" }),
        new DemoNotification({ userId: "u2", message: "Second notification" }),
        new DemoNotification({ userId: "u3", message: "Third notification" }),
      ]);

      yield* Effect.log("Batch sent successfully!");
      return { sentCount: 3 };
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
