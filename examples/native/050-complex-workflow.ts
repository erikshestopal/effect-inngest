import { defineNativeExample, eventCase } from "./_support.ts";

interface OrderItem {
  readonly sku: string;
  readonly qty: number;
  readonly price: number;
}

export default defineNativeExample((inngest) => {
  const OrderWorkflowFn = inngest.createFunction(
    {
      id: "process-order",
      triggers: [{ event: "examples/050/order/placed" }],
    },
    async ({ event, step, logger }) => {
      const orderId = typeof event.data.orderId === "string" ? event.data.orderId : "";
      const userId = typeof event.data.userId === "string" ? event.data.userId : "";
      const total = typeof event.data.total === "number" ? event.data.total : 0;
      const items: ReadonlyArray<OrderItem> = Array.isArray(event.data.items) ? event.data.items : [];

      logger.info(`Processing order ${orderId} for user ${userId}`);

      const isValid = await step.run("validate-order", () => {
        logger.info(`Validating order: ${items.length} items, total: $${total}`);
        const calculatedTotal = items.reduce((sum, item) => sum + item.qty * item.price, 0);
        return calculatedTotal === total;
      });

      if (!isValid) {
        logger.info(`Order ${orderId} validation failed`);
        return { orderId, status: "validation-failed" as const, transactionId: null, deliveryDate: null };
      }

      await step.run("reserve-inventory", () => {
        logger.info(`Reserving inventory for ${items.length} items`);
        for (const item of items) {
          logger.info(`Reserved ${item.qty}x ${item.sku}`);
        }
        return true;
      });

      logger.info(`Waiting for payment on order ${orderId}...`);
      const paymentEvent = await step.waitForEvent("wait-for-payment", {
        event: "examples/050/order/payment-received",
        timeout: "30s",
        if: `async.data.orderId == "${orderId}"`,
      });

      if (!paymentEvent) {
        logger.info(`Payment timeout for order ${orderId}`);
        await step.run("release-inventory", () => {
          logger.info(`Releasing inventory for order ${orderId}`);
          return true;
        });
        return { orderId, status: "payment-timeout" as const, transactionId: null, deliveryDate: null };
      }

      const transactionId = typeof paymentEvent.data.transactionId === "string" ? paymentEvent.data.transactionId : "";
      logger.info(`Payment received: ${transactionId}`);

      await step.sendEvent("send-confirmation", {
        name: "order/confirmed",
        data: { orderId, userId, total },
      });

      const deliveryDate = await step.run("schedule-delivery", () => {
        const delivery = new Date();
        delivery.setDate(delivery.getDate() + 4);
        const isoDate = delivery.toISOString().slice(0, 10);
        logger.info(`Delivery scheduled for: ${isoDate}`);
        return isoDate;
      });

      await step.sendEvent("notify-delivery", {
        name: "delivery/scheduled",
        data: { orderId, estimatedDelivery: deliveryDate },
      });

      logger.info(`Order ${orderId} completed successfully!`);
      return { orderId, status: "completed" as const, transactionId, deliveryDate };
    },
  );

  return {
    id: "050-complex-workflow",
    functions: [OrderWorkflowFn],
    cases: [
      eventCase({
        eventKey: "test",
        events: [
          {
            name: "examples/050/order/placed",
            data: {
              orderId: "order-050",
              userId: "user-050",
              items: [{ sku: "sku-1", qty: 2, price: 10 }],
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
                name: "examples/050/order/payment-received",
                data: { orderId: "order-050", transactionId: "txn-050" },
              },
            ],
          },
        ],
        expect: [{ functionId: "examples-050-complex-workflow-process-order" }],
      }),
    ],
  };
});
