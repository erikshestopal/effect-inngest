import { defineNativeExample, eventCase } from "./_support.ts";

export default defineNativeExample((inngest) => {
  const SleepTest = inngest.createFunction(
    {
      id: "sleep-test",
      triggers: [{ event: "examples/103-httpapi-step-sleep/demo/sleep" }],
    },
    async ({ step }) => {
      await step.sleep("wait", "1s");
      return { slept: true };
    },
  );

  return {
    id: "103-httpapi-step-sleep",
    functions: [SleepTest],
    cases: [
      eventCase({
        events: [{ name: "examples/103-httpapi-step-sleep/demo/sleep", data: {} }],
        expect: [{ functionId: "examples-103-httpapi-step-sleep-sleep-test" }],
      }),
    ],
  };
});
