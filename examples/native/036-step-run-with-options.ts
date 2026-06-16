import { defineNativeExample, eventCase } from "./_support.ts";

export default defineNativeExample((inngest) => {
  const StepOptions = inngest.createFunction(
    {
      id: "step-options-demo",
      triggers: [{ event: "examples/036-step-run-with-options/demo/step-options" }],
    },
    async ({ step }) => {
      const result1 = await step.run("basic-step", () => "basic");
      const result2 = await step.run({ id: "named-step", name: "Named Step" }, () => "with-name");
      const result3 = await step.run("third-step", () => "completed");
      return { results: [result1, result2, result3] };
    },
  );

  return {
    id: "036-step-run-with-options",
    functions: [StepOptions],
    cases: [
      eventCase({
        events: [{ name: "examples/036-step-run-with-options/demo/step-options", data: {} }],
        expect: [{ functionId: "examples-036-step-run-with-options-step-options-demo" }],
      }),
    ],
  };
});
