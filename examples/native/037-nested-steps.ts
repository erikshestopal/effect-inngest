import { defineNativeExample, eventCase } from "./_support.ts";

export default defineNativeExample((inngest) => {
  const NestedSteps = inngest.createFunction(
    {
      id: "nested-steps-demo",
      triggers: [{ event: "demo/nested" }],
    },
    async ({ step }) => {
      const level1 = await step.run("level-1", () => 10);
      const level2 = await step.run("level-2", () => level1 * 2);
      const level3 = await step.run("level-3", () => level2 + 5);
      const final = await step.run("final-computation", () => level1 + level2 + level3);
      return { level1, level2, level3, final };
    },
  );

  return {
    id: "037-nested-steps",
    functions: [NestedSteps],
    cases: [
      eventCase({
        events: [{ name: "demo/nested", data: {} }],
        expect: [{ functionId: "examples-037-nested-steps-nested-steps-demo" }],
      }),
    ],
  };
});
