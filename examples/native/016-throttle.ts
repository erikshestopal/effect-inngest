import { defineNativeExample, eventCase } from "./_support.ts";

export default defineNativeExample((inngest) => {
  const ThrottledFn = inngest.createFunction(
    {
      id: "throttled-fn",
      triggers: [{ event: "examples/016-throttle/demo/throttled" }],
      throttle: { limit: 1, period: "1s" },
    },
    async ({ event, logger }) => {
      const id = typeof event.data.id === "string" ? event.data.id : "";
      logger.info(`Processing throttled event id: ${id}`);
      return { id, processedAt: new Date().toISOString() };
    },
  );

  return {
    id: "016-throttle",
    functions: [ThrottledFn],
    cases: [
      eventCase({
        events: [{ name: "examples/016-throttle/demo/throttled", data: { id: "throttle-016" } }],
        expect: [{ functionId: "examples-016-throttle-throttled-fn" }],
      }),
    ],
  };
});
