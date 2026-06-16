import { defineNativeExample, eventCase } from "./_support.ts";

export default defineNativeExample((inngest) => {
  const BatchedFn = inngest.createFunction(
    {
      id: "batched-fn",
      triggers: [{ event: "examples/018-batch-events/demo/batched" }],
      batchEvents: { maxSize: 5, timeout: "1s" },
    },
    async ({ events, logger }) => {
      logger.info(`Processing batch of ${events.length} events: ${JSON.stringify(events)}`);
      const sum = events.reduce((acc, e) => acc + (typeof e.data.n === "number" ? e.data.n : 0), 0);
      return { count: events.length, sum };
    },
  );

  return {
    id: "018-batch-events",
    functions: [BatchedFn],
    cases: [
      eventCase({
        events: [{ name: "examples/018-batch-events/demo/batched", data: { n: 2 } }],
        expect: [{ functionId: "examples-018-batch-events-batched-fn" }],
      }),
    ],
  };
});
