import { FetchHttpClient } from "effect/unstable/http";
import { BunHttpServer, BunRuntime } from "@effect/platform-bun";
import * as HttpMiddleware from "effect/unstable/http/HttpMiddleware";
import * as HttpServer from "effect/unstable/http/HttpServer";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import { InngestClient, InngestFunction, InngestGroup } from "effect-inngest";

class DemoConcurrent extends Schema.TaggedClass<DemoConcurrent>()("demo/concurrent", {
  id: Schema.String,
}) {}

const ConcurrentFn = InngestFunction.make("concurrent-fn", {
  trigger: { event: DemoConcurrent },
  success: Schema.Struct({ id: Schema.String, completedAt: Schema.String }),
  concurrency: { limit: 1 },
});

const Group = InngestGroup.make(ConcurrentFn);

const HandlersLive = Group.toLayer({
  "concurrent-fn": ({ event, step }) =>
    Effect.gen(function* () {
      yield* Effect.log(`Starting execution for id: ${event.id}`);
      yield* step.sleep("wait-1s", "1 second");
      yield* Effect.log(`Completed execution for id: ${event.id}`);
      return { id: event.id, completedAt: new Date().toISOString() };
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
