import { defineNativeExample, eventCase } from "./_support.ts";

export default defineNativeExample((inngest) => {
  const SleepUntilFn = inngest.createFunction(
    {
      id: "sleep-until",
      triggers: [{ event: "demo/sleep-until" }],
    },
    async ({ step }) => {
      const target = new Date(Date.now() + 5000);
      await step.sleepUntil("wait-until", target);
      return { wokeAt: new Date().toISOString() };
    },
  );

  return {
    id: "006-step-sleepUntil",
    functions: [SleepUntilFn],
    cases: [
      eventCase({
        events: [{ name: "demo/sleep-until", data: {} }],
        expect: [{ functionId: "examples-006-step-sleepUntil-sleep-until" }],
      }),
    ],
  };
});
