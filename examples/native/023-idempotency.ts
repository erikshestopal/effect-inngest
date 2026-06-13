import { defineNativeExample, eventCase } from "./_support.ts";

export default defineNativeExample((inngest) => {
  const IdempotentFn = inngest.createFunction(
    {
      id: "checkout-handler",
      triggers: [{ event: "demo/idempotent" }],
      idempotency: "event.data.cartId",
    },
    async ({ event }) => {
      const cartId = typeof event.data.cartId === "string" ? event.data.cartId : "";
      return { checkoutId: `checkout-for-${cartId}` };
    },
  );

  return {
    id: "023-idempotency",
    functions: [IdempotentFn],
    cases: [
      eventCase({
        events: [{ name: "demo/idempotent", data: { cartId: "cart-023" } }],
        expect: [{ functionId: "examples-023-idempotency-checkout-handler" }],
      }),
    ],
  };
});
