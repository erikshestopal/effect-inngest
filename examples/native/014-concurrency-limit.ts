import { defineNativeExample, eventCase } from "./_support.ts";

export default defineNativeExample((inngest) => {
  const ConcurrentFn = inngest.createFunction(
    {
      id: "concurrent-fn",
      triggers: [{ event: "examples/014-concurrency-limit/demo/concurrent" }],
      concurrency: { limit: 1 },
    },
    async ({ event, step, logger }) => {
      const id = typeof event.data.id === "string" ? event.data.id : "";
      logger.info(`Starting execution for id: ${id}`);
      await step.sleep("wait-1s", "1 second");
      logger.info(`Completed execution for id: ${id}`);
      return { id, completedAt: new Date().toISOString() };
    },
  );

  return {
    id: "014-concurrency-limit",
    functions: [ConcurrentFn],
    cases: [
      eventCase({
        events: [{ name: "examples/014-concurrency-limit/demo/concurrent", data: { id: "concurrent-014" } }],
        expect: [{ functionId: "examples-014-concurrency-limit-concurrent-fn" }],
      }),
    ],
  };
});
