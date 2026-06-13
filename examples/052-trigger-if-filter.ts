import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { InngestFunction, InngestGroup } from "effect-inngest";
import { defineExample, eventCase } from "./_support.ts";

class OrderPlaced extends Schema.TaggedClass<OrderPlaced>()("order/placed", {
  orderId: Schema.String,
  amount: Schema.Number,
  customerId: Schema.optional(Schema.String),
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
      const customerId = event.customerId ?? "unknown";
      yield* Effect.log(`VIP order: ${event.orderId} for customer ${customerId}`);
      return { vip: true };
    }),
});

export default defineExample({
  id: "052-trigger-if-filter",
  group: Group,
  handlers: HandlersLive,
  cases: [
    eventCase({
      eventKey: "test",
      events: [
        {
          name: "order/placed",
          data: {
            orderId: "order-052",
            amount: 600,
            customerId: "customer-052",
          },
        },
      ],
      expect: [
        {
          functionTag: "process-high-value-order",
        },
        {
          functionTag: "process-vip-order",
        },
      ],
    }),
  ],
});
