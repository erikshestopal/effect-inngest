import { defineNativeExample, eventCase } from "./_support.ts";

export default defineNativeExample((inngest) => {
  const ProcessItemFn = inngest.createFunction(
    {
      id: "process-item",
      triggers: [{ event: "examples/054-concurrency-scope/demo/process-item" }],
      concurrency: { limit: 5, scope: "fn", key: "event.data.userId" },
    },
    async ({ event, logger }) => {
      const itemId = typeof event.data.itemId === "string" ? event.data.itemId : "";
      const userId = typeof event.data.userId === "string" ? event.data.userId : "";
      logger.info(`Processing item ${itemId} for user ${userId}`);
      await new Promise((resolve) => setTimeout(resolve, 500));
      return { processed: true, itemId };
    },
  );

  const SendNotificationFn = inngest.createFunction(
    {
      id: "send-notification",
      triggers: [{ event: "examples/054-concurrency-scope/demo/send-notification" }],
      concurrency: { limit: 10, scope: "env", key: "event.data.userId" },
    },
    async ({ event, logger }) => {
      const userId = typeof event.data.userId === "string" ? event.data.userId : "";
      const channel = typeof event.data.channel === "string" ? event.data.channel : "";
      logger.info(`Sending ${channel} notification to ${userId}`);
      await new Promise((resolve) => setTimeout(resolve, 200));
      return { sent: true, channel };
    },
  );

  const ExternalApiCallFn = inngest.createFunction(
    {
      id: "external-api-call",
      triggers: [{ event: "examples/054-concurrency-scope/demo/process-item" }],
      concurrency: { limit: 2, scope: "account", key: "event.data.userId" },
    },
    async ({ event, logger }) => {
      const itemId = typeof event.data.itemId === "string" ? event.data.itemId : "";
      logger.info(`Calling external API for item ${itemId}`);
      await new Promise((resolve) => setTimeout(resolve, 1000));
      return { apiCallComplete: true };
    },
  );

  return {
    id: "054-concurrency-scope",
    functions: [ProcessItemFn, SendNotificationFn, ExternalApiCallFn],
    cases: [
      eventCase({
        eventKey: "test",
        events: [
          {
            name: "examples/054-concurrency-scope/demo/process-item",
            data: { itemId: "item-054", userId: "user-054" },
          },
        ],
        expect: [
          { functionId: "examples-054-concurrency-scope-process-item" },
          { functionId: "examples-054-concurrency-scope-external-api-call" },
        ],
      }),
    ],
  };
});
