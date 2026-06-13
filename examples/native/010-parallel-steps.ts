import { defineNativeExample, eventCase } from "./_support.ts";

export default defineNativeExample((inngest) => {
  const ParallelFn = inngest.createFunction(
    {
      id: "parallel-steps",
      triggers: [{ event: "demo/parallel" }],
    },
    async ({ step }) => {
      const results = await Promise.all([
        step.run("step-1", () => 1),
        step.run("step-2", () => 2),
        step.run("step-3", () => 3),
      ]);
      return { results };
    },
  );

  return {
    id: "010-parallel-steps",
    functions: [ParallelFn],
    cases: [
      eventCase({
        events: [{ name: "demo/parallel", data: {} }],
        expect: [{ functionId: "examples-010-parallel-steps-parallel-steps" }],
      }),
    ],
  };
});
