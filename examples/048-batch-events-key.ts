import { FetchHttpClient } from "effect/unstable/http";
import { BunHttpServer, BunRuntime } from "@effect/platform-bun";
import * as HttpMiddleware from "effect/unstable/http/HttpMiddleware";
import * as HttpServer from "effect/unstable/http/HttpServer";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import { InngestClient, InngestFunction, InngestGroup } from "effect-inngest";

class DemoBatchKeyed extends Schema.TaggedClass<DemoBatchKeyed>()("demo/batch-keyed", {
  userId: Schema.String,
  item: Schema.String,
}) {}

const BatchKeyedFn = InngestFunction.make("batch-keyed", {
  trigger: { event: DemoBatchKeyed },
  success: Schema.Struct({ userId: Schema.String, items: Schema.Array(Schema.String), count: Schema.Number }),
  batchEvents: {
    maxSize: 10,
    timeout: "1 second",
    key: "event.data.userId",
  },
});

const Group = InngestGroup.make(BatchKeyedFn);

const HandlersLive = Group.toLayer({
  "batch-keyed": ({ event }) =>
    Effect.gen(function* () {
      const events = event as unknown as ReadonlyArray<DemoBatchKeyed>;
      const userId = events[0]?.userId ?? "unknown";
      const items = events.map((e) => e.item);

      yield* Effect.log(`Processing batch for user ${userId}: ${items.join(", ")}`);
      return {
        userId,
        items,
        count: events.length,
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
