import { defineNativeExample, eventCase } from "./_support.ts";

export default defineNativeExample((inngest) => {
  const ReturnTypesFn = inngest.createFunction(
    {
      id: "return-types-demo",
      triggers: [{ event: "examples/040-step-return-types/demo/return-types" }],
    },
    async ({ step, logger }) => {
      const stringResult = await step.run("return-string", () => "hello");

      const numberResult = await step.run("return-number", () => 42);

      const objectResult = await step.run("return-object", () => ({ key: "test", count: 100 }));

      const arrayResult = await step.run("return-array", () => [1, 2, 3, 4, 5]);

      const boolResult = await step.run("return-boolean", () => true);

      const combined = await step.run(
        "use-all-types",
        () => `${stringResult}-${numberResult}-${objectResult.key}-${arrayResult.length}-${boolResult}`,
      );

      logger.info(`Combined: ${combined}`);

      return {
        stringResult,
        numberResult,
        objectResult,
        arrayResult,
        boolResult,
      };
    },
  );

  return {
    id: "040-step-return-types",
    functions: [ReturnTypesFn],
    cases: [
      eventCase({
        events: [{ name: "examples/040-step-return-types/demo/return-types", data: {} }],
        expect: [{ functionId: "examples-040-step-return-types-return-types-demo" }],
      }),
    ],
  };
});
