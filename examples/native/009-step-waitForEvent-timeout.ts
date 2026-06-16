import { defineNativeExample, eventCase } from "./_support.ts";

export default defineNativeExample((inngest) => {
  const WaitTimeoutFn = inngest.createFunction(
    {
      id: "wait-timeout",
      triggers: [{ event: "examples/009-step-waitForEvent-timeout/demo/wait-timeout" }],
    },
    async ({ event, step }) => {
      const orderId = typeof event.data.orderId === "string" ? event.data.orderId : "";
      const matched = await step.waitForEvent("wait-for-signal", {
        event: "examples/009-step-waitForEvent-timeout/demo/timeout-signal",
        timeout: "5s",
        if: `async.data.orderId == "${orderId}"`,
      });
      return { timedOut: matched === null };
    },
  );

  return {
    id: "009-step-waitForEvent-timeout",
    functions: [WaitTimeoutFn],
    cases: [
      eventCase({
        events: [
          { name: "examples/009-step-waitForEvent-timeout/demo/wait-timeout", data: { orderId: "timeout-009" } },
        ],
        expect: [{ functionId: "examples-009-step-waitForEvent-timeout-wait-timeout" }],
      }),
    ],
  };
});
