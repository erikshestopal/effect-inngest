import { FetchHttpClient } from "effect/unstable/http";
import { BunHttpServer, BunRuntime } from "@effect/platform-bun";
import * as HttpMiddleware from "effect/unstable/http/HttpMiddleware";
import * as HttpServer from "effect/unstable/http/HttpServer";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import { InngestClient, InngestFunction, InngestGroup } from "effect-inngest";

class DemoBatched extends Schema.TaggedClass<DemoBatched>()("demo/batched", {
  n: Schema.Number,
}) {}

const BatchedFn = InngestFunction.make("batched-fn", {
  trigger: { event: DemoBatched },
  success: Schema.Struct({ count: Schema.Number, sum: Schema.Number }),
  batchEvents: { maxSize: 5, timeout: "1 second" },
});

const Group = InngestGroup.make(BatchedFn);

const HandlersLive = Group.toLayer({
  "batched-fn": ({ event }) =>
    Effect.gen(function* () {
      const events = [event] as ReadonlyArray<DemoBatched>;
      yield* Effect.log(`Processing batch of ${events.length} events: ${JSON.stringify(events)}`);
      const sum = events.reduce((acc, e) => acc + e.n, 0);
      return { count: events.length, sum };
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
