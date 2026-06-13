import { defineNativeExample, eventCase } from "./_support.ts";

export default defineNativeExample((inngest) => {
  const SendBatchFn = inngest.createFunction(
    {
      id: "send-batch",
      triggers: [{ event: "demo/send-batch" }],
    },
    async ({ step, logger }) => {
      logger.info("Sending batch of notifications...");

      await step.sendEvent("send-notifications", [
        { name: "demo/notification", data: { userId: "u1", message: "First notification" } },
        { name: "demo/notification", data: { userId: "u2", message: "Second notification" } },
        { name: "demo/notification", data: { userId: "u3", message: "Third notification" } },
      ]);

      logger.info("Batch sent successfully!");
      return { sentCount: 3 };
    },
  );

  return {
    id: "042-sendEvent-batch",
    functions: [SendBatchFn],
    cases: [
      eventCase({
        eventKey: "test",
        events: [{ name: "demo/send-batch", data: {} }],
        expect: [{ functionId: "examples-042-sendEvent-batch-send-batch" }],
      }),
    ],
  };
});
