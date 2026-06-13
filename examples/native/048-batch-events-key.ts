import { defineNativeExample, eventCase } from "./_support.ts";

export default defineNativeExample((inngest) => {
  const BatchKeyedFn = inngest.createFunction(
    {
      id: "batch-keyed",
      triggers: [{ event: "demo/batch-keyed" }],
      batchEvents: { maxSize: 10, timeout: "1s", key: "event.data.userId" },
    },
    async ({ events, logger }) => {
      const userId = typeof events[0]?.data.userId === "string" ? events[0].data.userId : "unknown";
      const items = events.map((e) => (typeof e.data.item === "string" ? e.data.item : ""));

      logger.info(`Processing batch for user ${userId}: ${items.join(", ")}`);
      return { userId, items, count: events.length };
    },
  );

  return {
    id: "048-batch-events-key",
    functions: [BatchKeyedFn],
    cases: [
      eventCase({
        events: [
          { name: "demo/batch-keyed", data: { userId: "user-048", item: "a" } },
          { name: "demo/batch-keyed", data: { userId: "user-048", item: "b" } },
        ],
        expect: [{ functionId: "examples-048-batch-events-key-batch-keyed" }],
      }),
    ],
  };
});
