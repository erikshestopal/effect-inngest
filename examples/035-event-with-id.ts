import { FetchHttpClient } from "@effect/platform";
import { BunHttpServer, BunRuntime } from "@effect/platform-bun";
import * as HttpMiddleware from "@effect/platform/HttpMiddleware";
import * as HttpServer from "@effect/platform/HttpServer";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import { InngestClient, InngestFunction, InngestGroup } from "effect-inngest";

class DemoIdempotentEvent extends Schema.TaggedClass<DemoIdempotentEvent>()("demo/idempotent-event", {
  data: Schema.String,
}) {}

const IdempotentFn = InngestFunction.make("idempotent-handler", {
  trigger: { event: DemoIdempotentEvent },
  success: Schema.Struct({ processed: Schema.Boolean, eventId: Schema.String }),
});

const Group = InngestGroup.make(IdempotentFn);

const HandlersLive = Group.toLayer({
  "idempotent-handler": ({ event, run }) =>
    Effect.gen(function* () {
      yield* Effect.log(`Processing event, runId: ${run.id}, data: ${event.data}`);
      return { processed: true, eventId: run.id };
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
