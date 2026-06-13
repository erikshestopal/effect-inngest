import { defineNativeExample, eventCase } from "./_support.ts";

export default defineNativeExample((inngest) => {
  const ThrottleKeyedFn = inngest.createFunction(
    {
      id: "throttle-keyed",
      triggers: [{ event: "demo/throttle-keyed" }],
      throttle: { limit: 1, period: "1s", key: "event.data.teamId" },
    },
    async ({ event, logger }) => {
      const teamId = typeof event.data.teamId === "string" ? event.data.teamId : "";
      logger.info(`Processing throttled event for team: ${teamId}`);
      return { teamId, processedAt: new Date().toISOString() };
    },
  );

  return {
    id: "046-throttle-key",
    functions: [ThrottleKeyedFn],
    cases: [
      eventCase({
        events: [{ name: "demo/throttle-keyed", data: { teamId: "team-046" } }],
        expect: [{ functionId: "examples-046-throttle-key-throttle-keyed" }],
      }),
    ],
  };
});
