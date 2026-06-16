import { defineNativeExample, eventCase } from "./_support.ts";

export default defineNativeExample((inngest) => {
  const StepSingle = inngest.createFunction(
    {
      id: "step-single",
      triggers: [{ event: "examples/102-httpapi-step-run/demo/step-single" }],
    },
    async ({ event, step }) => {
      const value = typeof event.data.value === "number" ? event.data.value : 0;
      const doubled = await step.run("double", () => value * 2);
      return { doubled };
    },
  );

  return {
    id: "102-httpapi-step-run",
    functions: [StepSingle],
    cases: [
      eventCase({
        events: [{ name: "examples/102-httpapi-step-run/demo/step-single", data: { value: 21 } }],
        expect: [{ functionId: "examples-102-httpapi-step-run-step-single" }],
      }),
    ],
  };
});
