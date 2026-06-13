import { defineNativeExample, eventCase } from "./_support.ts";

export default defineNativeExample((inngest) => {
  const WaitMatchFn = inngest.createFunction(
    {
      id: "wait-for-invoice-payment",
      triggers: [{ event: "demo/wait-match" }],
    },
    async ({ event, step, logger }) => {
      const invoiceId = typeof event.data.invoiceId === "string" ? event.data.invoiceId : "";

      logger.info(`Waiting for payment on invoice: ${invoiceId}`);

      const paidEvent = await step.waitForEvent("wait-for-payment", {
        event: "demo/invoice-paid",
        timeout: "30s",
        if: `async.data.invoiceId == "${invoiceId}"`,
      });

      if (paidEvent) {
        const amount = typeof paidEvent.data.amount === "number" ? paidEvent.data.amount : null;
        logger.info(`Invoice ${invoiceId} paid! Amount: ${amount}`);
        return { invoiceId, amount };
      }

      logger.info(`Payment timeout for invoice: ${invoiceId}`);
      return { invoiceId, amount: null };
    },
  );

  return {
    id: "041-waitForEvent-match",
    functions: [WaitMatchFn],
    cases: [
      eventCase({
        events: [{ name: "demo/wait-match", data: { invoiceId: "invoice-041" } }],
        afterEvents: [
          {
            delayMs: 1000,
            events: [{ name: "demo/invoice-paid", data: { invoiceId: "invoice-041", amount: 123.45 } }],
          },
        ],
        expect: [{ functionId: "examples-041-waitForEvent-match-wait-for-invoice-payment" }],
      }),
    ],
  };
});
