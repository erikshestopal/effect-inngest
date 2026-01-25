import { FetchHttpClient } from "@effect/platform";
import { BunHttpServer, BunRuntime } from "@effect/platform-bun";
import * as HttpMiddleware from "@effect/platform/HttpMiddleware";
import * as HttpServer from "@effect/platform/HttpServer";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import { InngestClient, InngestFunction, InngestGroup } from "effect-inngest";

class DemoDebounceKeyed extends Schema.TaggedClass<DemoDebounceKeyed>()("demo/debounce-keyed", {
  userId: Schema.String,
  action: Schema.String,
}) {}

const DebounceKeyedFn = InngestFunction.make("debounce-keyed", {
  trigger: { event: DemoDebounceKeyed },
  success: Schema.Struct({ userId: Schema.String, action: Schema.String, processedAt: Schema.String }),
  debounce: {
    period: "1 second",
    key: "event.data.userId",
  },
});

const Group = InngestGroup.make(DebounceKeyedFn);

const HandlersLive = Group.toLayer({
  "debounce-keyed": ({ event }) =>
    Effect.gen(function* () {
      yield* Effect.log(`Processing debounced action for user ${event.userId}: ${event.action}`);
      return {
        userId: event.userId,
        action: event.action,
        processedAt: new Date().toISOString(),
      };
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
