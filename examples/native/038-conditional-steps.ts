import { defineNativeExample, eventCase } from "./_support.ts";

export default defineNativeExample((inngest) => {
  const Conditional = inngest.createFunction(
    {
      id: "conditional-steps",
      triggers: [{ event: "demo/conditional" }],
    },
    async ({ event, step }) => {
      await step.run("setup", () => "initialized");

      if (event.data.shouldSkip === true) {
        const quickResult = await step.run("quick-path", () => "skipped heavy work");
        return { path: "quick", result: quickResult };
      }

      const step1 = await step.run("heavy-step-1", () => "processed-1");
      const step2 = await step.run("heavy-step-2", () => "processed-2");
      const step3 = await step.run("heavy-step-3", () => "processed-3");
      return { path: "full", result: `${step1},${step2},${step3}` };
    },
  );

  return {
    id: "038-conditional-steps",
    functions: [Conditional],
    cases: [
      eventCase({
        events: [{ name: "demo/conditional", data: { shouldSkip: false } }],
        expect: [{ functionId: "examples-038-conditional-steps-conditional-steps" }],
      }),
    ],
  };
});
