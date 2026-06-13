import { defineNativeExample, eventCase } from "./_support.ts";

// The Effect example sends events directly via the client (no Inngest function).
// In the native harness this maps to a case that emits the same events with no
// expected function executions.
export default defineNativeExample(() => {
  return {
    id: "051-client-send",
    functions: [],
    cases: [
      eventCase({
        events: [
          { name: "user/created", data: { userId: "123", email: "alice@example.com" } },
          { name: "order/placed", data: { orderId: "o1", userId: "123", total: 99.99 } },
          { name: "order/placed", data: { orderId: "o2", userId: "456", total: 149.99 } },
          { name: "notification/send", data: { channel: "email", userId: "123", template: "order-confirmation" } },
          { name: "payment/received", data: { orderId: "o1", amount: 99.99 }, id: "payment-o1-20240115" },
        ],
        expect: [],
      }),
    ],
  };
});
