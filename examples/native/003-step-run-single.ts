import { defineNativeExample, eventCase } from "./_support.ts";

export default defineNativeExample((inngest) => {
  const StepSingleFn = inngest.createFunction(
    {
      id: "step-single",
      triggers: [{ event: "demo/step-single" }],
    },
    async ({ event, step, logger }) => {
      const value = typeof event.data.value === "number" ? event.data.value : 0;
      logger.info(`step-single input: ${value}`);
      const doubled = await step.run("double", () => {
        logger.info(`doubling ${value}`);
        return value * 2;
      });
      logger.info(`step-single doubled: ${doubled}`);
      return { doubled };
    },
  );

  return {
    id: "003-step-run-single",
    functions: [StepSingleFn],
    cases: [
      eventCase({
        events: [{ name: "demo/step-single", data: { value: 21 } }],
        expect: [{ functionId: "examples-003-step-run-single-step-single" }],
      }),
    ],
  };
});
