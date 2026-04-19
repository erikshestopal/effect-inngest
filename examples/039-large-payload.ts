import { FetchHttpClient } from "effect/unstable/http";
import { BunHttpServer, BunRuntime } from "@effect/platform-bun";
import * as HttpMiddleware from "effect/unstable/http/HttpMiddleware";
import * as HttpServer from "effect/unstable/http/HttpServer";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import { InngestClient, InngestFunction, InngestGroup } from "effect-inngest";

const ItemSchema = Schema.Struct({
  id: Schema.String,
  value: Schema.Number,
});

class DemoLargePayload extends Schema.TaggedClass<DemoLargePayload>()("demo/large-payload", {
  items: Schema.Array(ItemSchema),
}) {}

const LargePayloadFn = InngestFunction.make("process-large-payload", {
  trigger: { event: DemoLargePayload },
  success: Schema.Struct({
    itemCount: Schema.Number,
    totalValue: Schema.Number,
    processedIds: Schema.Array(Schema.String),
  }),
});

const Group = InngestGroup.make(LargePayloadFn);

const HandlersLive = Group.toLayer({
  "process-large-payload": ({ event, step }) =>
    Effect.gen(function* () {
      const processedItems = yield* step.run(
        "process-all-items",
        Effect.succeed(
          event.items.map((item) => ({
            id: item.id,
            processedValue: item.value * 2,
          })),
        ),
      );

      const totalValue = yield* step.run(
        "calculate-total",
        Effect.succeed(event.items.reduce((sum, item) => sum + item.value, 0)),
      );

      return {
        itemCount: event.items.length,
        totalValue,
        processedIds: processedItems.map((p) => p.id),
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
