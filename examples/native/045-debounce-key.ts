import { defineNativeExample, eventCase } from "./_support.ts";

export default defineNativeExample((inngest) => {
  const DebounceKeyedFn = inngest.createFunction(
    {
      id: "debounce-keyed",
      triggers: [{ event: "examples/045-debounce-key/demo/debounce-keyed" }],
      debounce: { period: "1s", key: "event.data.userId" },
    },
    async ({ event, logger }) => {
      const userId = typeof event.data.userId === "string" ? event.data.userId : "";
      const action = typeof event.data.action === "string" ? event.data.action : "";
      logger.info(`Processing debounced action for user ${userId}: ${action}`);
      return { userId, action, processedAt: new Date().toISOString() };
    },
  );

  return {
    id: "045-debounce-key",
    functions: [DebounceKeyedFn],
    cases: [
      eventCase({
        events: [
          { name: "examples/045-debounce-key/demo/debounce-keyed", data: { userId: "user-045", action: "update" } },
        ],
        expect: [{ functionId: "examples-045-debounce-key-debounce-keyed" }],
      }),
    ],
  };
});
