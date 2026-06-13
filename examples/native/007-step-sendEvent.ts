import { defineNativeExample, eventCase } from "./_support.ts";

export default defineNativeExample((inngest) => {
  const SendSingleFn = inngest.createFunction(
    {
      id: "send-single",
      triggers: [{ event: "demo/send-single" }],
    },
    async ({ event, step }) => {
      const userId = typeof event.data.userId === "string" ? event.data.userId : "";
      await step.sendEvent("send-notification", {
        name: "demo/notification",
        data: { userId, message: "Hello from step.sendEvent!" },
      });
      return { sent: true };
    },
  );

  return {
    id: "007-step-sendEvent",
    functions: [SendSingleFn],
    cases: [
      eventCase({
        eventKey: "test",
        events: [{ name: "demo/send-single", data: { userId: "u_001" } }],
        expect: [{ functionId: "examples-007-step-sendEvent-send-single" }],
      }),
    ],
  };
});
