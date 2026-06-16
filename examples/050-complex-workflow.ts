import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { InngestFunction, InngestGroup, InngestEvent } from "effect-inngest";
import { defineExample, eventCase } from "./_support.ts";

const OrderPlaced = InngestEvent.make(
  "examples/050-complex-workflow/examples/050/order/placed",
  Schema.Struct({
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
  }),
);

const OrderPaymentReceived = InngestEvent.make(
  "examples/050-complex-workflow/examples/050/order/payment-received",
  Schema.Struct({
    orderId: Schema.String,
    transactionId: Schema.String,
  }),
);

const OrderConfirmed = InngestEvent.make(
  "examples/050-complex-workflow/order/confirmed",
  Schema.Struct({
    orderId: Schema.String,
    userId: Schema.String,
    total: Schema.Number,
  }),
);

const DeliveryScheduled = InngestEvent.make(
  "examples/050-complex-workflow/delivery/scheduled",
  Schema.Struct({
    orderId: Schema.String,
    estimatedDelivery: Schema.String,
  }),
);

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
      yield* Effect.log(`Processing order ${event.data.orderId} for user ${event.data.userId}`);

      const isValid = yield* step.run(
        "validate-order",
        Effect.gen(function* () {
          yield* Effect.log(`Validating order: ${event.data.items.length} items, total: $${event.data.total}`);
          const calculatedTotal = event.data.items.reduce((sum, item) => sum + item.qty * item.price, 0);
          return calculatedTotal === event.data.total;
        }),
      );

      if (!isValid) {
        yield* Effect.log(`Order ${event.data.orderId} validation failed`);
        return {
          orderId: event.data.orderId,
          status: "validation-failed" as const,
          transactionId: null,
          deliveryDate: null,
        };
      }

      yield* step.run(
        "reserve-inventory",
        Effect.gen(function* () {
          yield* Effect.log(`Reserving inventory for ${event.data.items.length} items`);
          for (const item of event.data.items) {
            yield* Effect.log(`Reserved ${item.qty}x ${item.sku}`);
          }
          return true;
        }),
      );

      yield* Effect.log(`Waiting for payment on order ${event.data.orderId}...`);
      const paymentEvent = yield* step.waitForEvent("wait-for-payment", OrderPaymentReceived, {
        timeout: Duration.seconds(30),
        if: `async.data.orderId == "${event.data.orderId}"`,
      });

      if (Option.isNone(paymentEvent)) {
        yield* Effect.log(`Payment timeout for order ${event.data.orderId}`);
        yield* step.run(
          "release-inventory",
          Effect.gen(function* () {
            yield* Effect.log(`Releasing inventory for order ${event.data.orderId}`);
            return true;
          }),
        );
        return {
          orderId: event.data.orderId,
          status: "payment-timeout" as const,
          transactionId: null,
          deliveryDate: null,
        };
      }

      const transactionId = paymentEvent.value.data.transactionId;
      yield* Effect.log(`Payment received: ${transactionId}`);

      yield* step.sendEvent(
        "send-confirmation",
        OrderConfirmed.make({
          orderId: event.data.orderId,
          userId: event.data.userId,
          total: event.data.total,
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
        DeliveryScheduled.make({
          orderId: event.data.orderId,
          estimatedDelivery: deliveryDate,
        }),
      );

      yield* Effect.log(`Order ${event.data.orderId} completed successfully!`);
      return {
        orderId: event.data.orderId,
        status: "completed" as const,
        transactionId,
        deliveryDate,
      };
    }),
});

export default defineExample({
  id: "050-complex-workflow",
  group: Group,
  handlers: HandlersLive,
  cases: [
    eventCase({
      eventKey: "test",
      events: [
        {
          name: "examples/050-complex-workflow/examples/050/order/placed",
          data: {
            orderId: "order-050",
            userId: "user-050",
            items: [
              {
                sku: "sku-1",
                qty: 2,
                price: 10,
              },
            ],
            total: 20,
          },
        },
      ],
      afterEvents: [
        {
          delayMs: 1000,
          eventKey: "test",
          events: [
            {
              name: "examples/050-complex-workflow/examples/050/order/payment-received",
              data: {
                orderId: "order-050",
                transactionId: "txn-050",
              },
            },
          ],
        },
      ],
      expect: [
        {
          spans: [
            "validate-order",
            "reserve-inventory",
            "wait-for-payment",
            "send-confirmation",
            "schedule-delivery",
            "notify-delivery",
          ],
          functionTag: "process-order",
        },
      ],
      timeoutMs: 40000,
    }),
  ],
});
