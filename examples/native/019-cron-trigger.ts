import { defineNativeExample } from "./_support.ts";

export default defineNativeExample((inngest) => {
  const CronFn = inngest.createFunction(
    {
      id: "cron-every-minute",
      triggers: [{ cron: "* * * * *" }],
    },
    async ({ logger }) => {
      const now = new Date().toISOString();
      logger.info(`Cron executed at: ${now}`);
      return { executedAt: now };
    },
  );

  return {
    id: "019-cron-trigger",
    functions: [CronFn],
    cases: [],
  };
});
