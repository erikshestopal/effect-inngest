import { defineNativeExample, eventCase } from "./_support.ts";

export default defineNativeExample((inngest) => {
  const RateLimitedFn = inngest.createFunction(
    {
      id: "rate-limited-fn",
      triggers: [{ event: "demo/rate-limited" }],
      rateLimit: { limit: 1, period: "1s" },
    },
    async ({ event, logger }) => {
      const id = typeof event.data.id === "string" ? event.data.id : "";
      logger.info(`Processing rate-limited event id: ${id}`);
      return { id, processedAt: new Date().toISOString() };
    },
  );

  return {
    id: "017-rate-limit",
    functions: [RateLimitedFn],
    cases: [
      eventCase({
        events: [{ name: "demo/rate-limited", data: { id: "rate-017" } }],
        expect: [{ functionId: "examples-017-rate-limit-rate-limited-fn" }],
      }),
    ],
  };
});
