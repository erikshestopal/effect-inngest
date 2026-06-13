import { defineNativeExample } from "./_support.ts";

export default defineNativeExample((inngest) => {
  const CronTimezoneFn = inngest.createFunction(
    {
      id: "daily-9am-est",
      triggers: [{ cron: "TZ=America/New_York 0 9 * * *" }],
    },
    async ({ logger }) => {
      const now = new Date().toISOString();
      logger.info(`Daily 9am EST job executed at: ${now}`);
      return { executedAt: now, timezone: "America/New_York" };
    },
  );

  return {
    id: "049-cron-timezone",
    functions: [CronTimezoneFn],
    cases: [],
  };
});
