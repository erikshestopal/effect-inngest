import { defineNativeExample, eventCase } from "./_support.ts";

export default defineNativeExample((inngest) => {
  const RateLimitKeyedFn = inngest.createFunction(
    {
      id: "rate-limit-keyed",
      triggers: [{ event: "examples/047-rate-limit-key/demo/rate-keyed" }],
      rateLimit: { limit: 2, period: "1m", key: "event.data.companyId" },
    },
    async ({ event, logger }) => {
      const companyId = typeof event.data.companyId === "string" ? event.data.companyId : "";
      logger.info(`Processing rate-limited event for company: ${companyId}`);
      return { companyId, processedAt: new Date().toISOString() };
    },
  );

  return {
    id: "047-rate-limit-key",
    functions: [RateLimitKeyedFn],
    cases: [
      eventCase({
        events: [{ name: "examples/047-rate-limit-key/demo/rate-keyed", data: { companyId: "company-047" } }],
        expect: [{ functionId: "examples-047-rate-limit-key-rate-limit-keyed" }],
      }),
    ],
  };
});
