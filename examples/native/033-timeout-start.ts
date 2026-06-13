import { defineNativeExample, eventCase } from "./_support.ts";

export default defineNativeExample((inngest) => {
  const SlowStart = inngest.createFunction(
    {
      id: "slow-start-task",
      triggers: [{ event: "demo/slow-start" }],
      timeouts: { start: "10s" },
    },
    async ({ step }) => {
      await step.run("quick-work", () => "Started successfully");
      return { status: "completed" };
    },
  );

  return {
    id: "033-timeout-start",
    functions: [SlowStart],
    cases: [
      eventCase({
        events: [{ name: "demo/slow-start", data: {} }],
        expect: [{ functionId: "examples-033-timeout-start-slow-start-task" }],
      }),
    ],
  };
});
