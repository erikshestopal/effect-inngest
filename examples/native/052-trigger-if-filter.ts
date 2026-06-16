import { defineNativeExample, eventCase } from "./_support.ts";

export default defineNativeExample((inngest) => {
  const HighValueOrderFn = inngest.createFunction(
    {
      id: "process-high-value-order",
      triggers: [{ event: "examples/052-trigger-if-filter/order/placed", if: "event.data.amount > 100" }],
    },
    async ({ event, logger }) => {
      const orderId = typeof event.data.orderId === "string" ? event.data.orderId : "";
      const amount = typeof event.data.amount === "number" ? event.data.amount : 0;
      logger.info(`Processing high-value order: ${orderId} ($${amount})`);
      return { processed: true, priority: "high" };
    },
  );

  const VipOrderFn = inngest.createFunction(
    {
      id: "process-vip-order",
      triggers: [
        {
          event: "examples/052-trigger-if-filter/order/placed",
          if: "event.data.amount > 500 && has(event.data.customerId)",
        },
      ],
    },
    async ({ event, logger }) => {
      const orderId = typeof event.data.orderId === "string" ? event.data.orderId : "";
      const customerId = typeof event.data.customerId === "string" ? event.data.customerId : "unknown";
      logger.info(`VIP order: ${orderId} for customer ${customerId}`);
      return { vip: true };
    },
  );

  return {
    id: "052-trigger-if-filter",
    functions: [HighValueOrderFn, VipOrderFn],
    cases: [
      eventCase({
        eventKey: "test",
        events: [
          {
            name: "examples/052-trigger-if-filter/order/placed",
            data: { orderId: "order-052", amount: 600, customerId: "customer-052" },
          },
        ],
        expect: [
          { functionId: "examples-052-trigger-if-filter-process-high-value-order" },
          { functionId: "examples-052-trigger-if-filter-process-vip-order" },
        ],
      }),
    ],
  };
});
