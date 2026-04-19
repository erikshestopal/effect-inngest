import { FetchHttpClient } from "effect/unstable/http";
import { BunHttpServer, BunRuntime } from "@effect/platform-bun";
import * as HttpMiddleware from "effect/unstable/http/HttpMiddleware";
import * as HttpServer from "effect/unstable/http/HttpServer";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { InngestClient, InngestFunction, InngestGroup } from "effect-inngest";

class OrderPlaced extends Schema.TaggedClass<OrderPlaced>()("order/placed", {
  orderId: Schema.String,
  userId: Schema.String,
  items: Schema.Array(
    Schema.Struct({
      sku: Schema.String,
      qty: Schema.Number,
      price: Schema.Number,
    }),
  ),
  total: Schema.Number,
}) {}

class OrderPaymentReceived extends Schema.TaggedClass<OrderPaymentReceived>()("order/payment-received", {
  orderId: Schema.String,
  transactionId: Schema.String,
}) {}

class OrderConfirmed extends Schema.TaggedClass<OrderConfirmed>()("order/confirmed", {
  orderId: Schema.String,
  userId: Schema.String,
  total: Schema.Number,
}) {}

class DeliveryScheduled extends Schema.TaggedClass<DeliveryScheduled>()("delivery/scheduled", {
  orderId: Schema.String,
  estimatedDelivery: Schema.String,
}) {}

const OrderWorkflowFn = InngestFunction.make("process-order", {
  trigger: { event: OrderPlaced },
  success: Schema.Struct({
    orderId: Schema.String,
    status: Schema.Literals(["completed", "payment-timeout", "validation-failed"]),
    transactionId: Schema.NullOr(Schema.String),
    deliveryDate: Schema.NullOr(Schema.String),
  }),
});

const Group = InngestGroup.make(OrderWorkflowFn);

const HandlersLive = Group.toLayer({
  "process-order": ({ event, step }) =>
    Effect.gen(function* () {
      yield* Effect.log(`Processing order ${event.orderId} for user ${event.userId}`);

      const isValid = yield* step.run(
        "validate-order",
        Effect.gen(function* () {
          yield* Effect.log(`Validating order: ${event.items.length} items, total: $${event.total}`);
          const calculatedTotal = event.items.reduce((sum, item) => sum + item.qty * item.price, 0);
          return calculatedTotal === event.total;
        }),
      );

      if (!isValid) {
        yield* Effect.log(`Order ${event.orderId} validation failed`);
        return {
          orderId: event.orderId,
          status: "validation-failed" as const,
          transactionId: null,
          deliveryDate: null,
        };
      }

      yield* step.run(
        "reserve-inventory",
        Effect.gen(function* () {
          yield* Effect.log(`Reserving inventory for ${event.items.length} items`);
          for (const item of event.items) {
            yield* Effect.log(`Reserved ${item.qty}x ${item.sku}`);
          }
          return true;
        }),
      );

      yield* Effect.log(`Waiting for payment on order ${event.orderId}...`);
      const paymentEvent = yield* step.waitForEvent("wait-for-payment", OrderPaymentReceived, {
        timeout: Duration.seconds(30),
        if: `async.data.orderId == "${event.orderId}"`,
      });

      if (Option.isNone(paymentEvent)) {
        yield* Effect.log(`Payment timeout for order ${event.orderId}`);
        yield* step.run(
          "release-inventory",
          Effect.gen(function* () {
            yield* Effect.log(`Releasing inventory for order ${event.orderId}`);
            return true;
          }),
        );
        return {
          orderId: event.orderId,
          status: "payment-timeout" as const,
          transactionId: null,
          deliveryDate: null,
        };
      }

      const transactionId = paymentEvent.value.transactionId;
      yield* Effect.log(`Payment received: ${transactionId}`);

      yield* step.sendEvent(
        "send-confirmation",
        new OrderConfirmed({
          orderId: event.orderId,
          userId: event.userId,
          total: event.total,
        }),
      );

      const deliveryDate: string = yield* step.run(
        "schedule-delivery",
        Effect.gen(function* () {
          const delivery = new Date();
          delivery.setDate(delivery.getDate() + 4);
          const isoDate = delivery.toISOString().slice(0, 10);
          yield* Effect.log(`Delivery scheduled for: ${isoDate}`);
          return isoDate;
        }),
      );

      yield* step.sendEvent(
        "notify-delivery",
        new DeliveryScheduled({
          orderId: event.orderId,
          estimatedDelivery: deliveryDate,
        }),
      );

      yield* Effect.log(`Order ${event.orderId} completed successfully!`);
      return {
        orderId: event.orderId,
        status: "completed" as const,
        transactionId,
        deliveryDate,
      };
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
