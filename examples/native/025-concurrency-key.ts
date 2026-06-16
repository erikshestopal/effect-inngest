import { defineNativeExample, eventCase } from "./_support.ts";

export default defineNativeExample((inngest) => {
  const KeyedConcurrentFn = inngest.createFunction(
    {
      id: "user-processor",
      triggers: [{ event: "examples/025-concurrency-key/demo/concurrent-keyed" }],
      concurrency: { limit: 1, key: "event.data.userId" },
    },
    async ({ event, step }) => {
      const userId = typeof event.data.userId === "string" ? event.data.userId : "";
      await step.run("process", async () => `Processing ${userId}`);
      await step.sleep("simulate-work", "1s");
      return { processed: userId };
    },
  );

  return {
    id: "025-concurrency-key",
    functions: [KeyedConcurrentFn],
    cases: [
      eventCase({
        events: [{ name: "examples/025-concurrency-key/demo/concurrent-keyed", data: { userId: "user-025" } }],
        expect: [{ functionId: "examples-025-concurrency-key-user-processor" }],
      }),
    ],
  };
});
