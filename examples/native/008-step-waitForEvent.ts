import { defineNativeExample, eventCase } from "./_support.ts";

export default defineNativeExample((inngest) => {
  const WaitForEventFn = inngest.createFunction(
    {
      id: "wait-for-event",
      triggers: [{ event: "examples/008-step-waitForEvent/demo/wait-start" }],
    },
    async ({ event, step }) => {
      const orderId = typeof event.data.orderId === "string" ? event.data.orderId : "";
      const matched = await step.waitForEvent("wait-for-complete", {
        event: "examples/008-step-waitForEvent/demo/wait-complete",
        timeout: "5m",
        if: `async.data.orderId == "${orderId}"`,
      });
      const receivedStatus = matched && typeof matched.data.status === "string" ? matched.data.status : null;
      return { receivedStatus };
    },
  );

  return {
    id: "008-step-waitForEvent",
    functions: [WaitForEventFn],
    cases: [
      eventCase({
        events: [{ name: "examples/008-step-waitForEvent/demo/wait-start", data: { orderId: "order-008" } }],
        afterEvents: [
          {
            delayMs: 1000,
            events: [
              {
                name: "examples/008-step-waitForEvent/demo/wait-complete",
                data: { orderId: "order-008", status: "approved" },
              },
            ],
          },
        ],
        expect: [{ functionId: "examples-008-step-waitForEvent-wait-for-event" }],
      }),
    ],
  };
});
