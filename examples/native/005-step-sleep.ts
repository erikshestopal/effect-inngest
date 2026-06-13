import { defineNativeExample, eventCase } from "./_support.ts";

export default defineNativeExample((inngest) => {
  const SleepFn = inngest.createFunction(
    {
      id: "sleep-test",
      triggers: [{ event: "demo/sleep" }],
    },
    async ({ step, logger }) => {
      logger.info("sleep-test starting");
      await step.sleep("wait", "1s");
      logger.info("sleep-test completed");
      return { slept: true };
    },
  );

  return {
    id: "005-step-sleep",
    functions: [SleepFn],
    cases: [
      eventCase({
        events: [{ name: "demo/sleep", data: {} }],
        expect: [{ functionId: "examples-005-step-sleep-sleep-test" }],
      }),
    ],
  };
});
