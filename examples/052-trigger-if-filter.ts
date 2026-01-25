import { FetchHttpClient } from "@effect/platform";
import { BunHttpServer, BunRuntime } from "@effect/platform-bun";
import * as HttpMiddleware from "@effect/platform/HttpMiddleware";
import * as HttpServer from "@effect/platform/HttpServer";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { InngestClient, InngestFunction, InngestGroup } from "effect-inngest";

class OrderPlaced extends Schema.TaggedClass<OrderPlaced>()("order/placed", {
  orderId: Schema.String,
  amount: Schema.Number,
  customerId: Schema.optionalWith(Schema.String, { as: "Option" }),
}) {}

const HighValueOrderFn = InngestFunction.make("process-high-value-order", {
  trigger: {
    event: OrderPlaced,
    if: "event.data.amount > 100",
  },
  success: Schema.Struct({ processed: Schema.Boolean, priority: Schema.String }),
});

const VipOrderFn = InngestFunction.make("process-vip-order", {
  trigger: {
    event: OrderPlaced,
    if: "event.data.amount > 500 && has(event.data.customerId)",
  },
  success: Schema.Struct({ vip: Schema.Boolean }),
});

const Group = InngestGroup.make(HighValueOrderFn, VipOrderFn);

const HandlersLive = Group.toLayer({
  "process-high-value-order": ({ event }) =>
    Effect.gen(function* () {
      yield* Effect.log(`Processing high-value order: ${event.orderId} ($${event.amount})`);
      return { processed: true, priority: "high" };
    }),

  "process-vip-order": ({ event }) =>
    Effect.gen(function* () {
      const customerId = Option.isSome(event.customerId) ? event.customerId.value : "unknown";
      yield* Effect.log(`VIP order: ${event.orderId} for customer ${customerId}`);
      return { vip: true };
    }),
});

const ClientLive = InngestClient.layer({
  id: "demo-trigger-if",
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
