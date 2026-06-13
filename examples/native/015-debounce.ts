import { defineNativeExample, eventCase } from "./_support.ts";

export default defineNativeExample((inngest) => {
  const DebouncedFn = inngest.createFunction(
    {
      id: "debounced-fn",
      triggers: [{ event: "demo/debounced" }],
      debounce: { period: "1s" },
    },
    async ({ event, logger }) => {
      const seq = typeof event.data.seq === "number" ? event.data.seq : 0;
      logger.info(`Processing debounced event with seq: ${seq}`);
      return { seq, processedAt: new Date().toISOString() };
    },
  );

  return {
    id: "015-debounce",
    functions: [DebouncedFn],
    cases: [
      eventCase({
        events: [{ name: "demo/debounced", data: { seq: 1 } }],
        expect: [{ functionId: "examples-015-debounce-debounced-fn" }],
      }),
    ],
  };
});
