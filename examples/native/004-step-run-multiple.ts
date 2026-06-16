import { defineNativeExample, eventCase } from "./_support.ts";

export default defineNativeExample((inngest) => {
  const StepChainFn = inngest.createFunction(
    {
      id: "step-chain",
      triggers: [{ event: "examples/004-step-run-multiple/demo/step-chain" }],
    },
    async ({ event, step, logger }) => {
      const value = typeof event.data.value === "number" ? event.data.value : 0;
      logger.info(`step-chain input: ${value}`);
      const doubled = await step.run("double", () => {
        logger.info(`doubling ${value}`);
        return value * 2;
      });
      const result = await step.run("add-ten", () => {
        logger.info(`adding 10 to ${doubled}`);
        return doubled + 10;
      });
      logger.info(`step-chain result: ${result}`);
      return { result };
    },
  );

  return {
    id: "004-step-run-multiple",
    functions: [StepChainFn],
    cases: [
      eventCase({
        events: [{ name: "examples/004-step-run-multiple/demo/step-chain", data: { value: 16 } }],
        expect: [{ functionId: "examples-004-step-run-multiple-step-chain" }],
      }),
    ],
  };
});
