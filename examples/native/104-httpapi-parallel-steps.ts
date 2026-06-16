import { defineNativeExample, eventCase } from "./_support.ts";

export default defineNativeExample((inngest) => {
  const ParallelTest = inngest.createFunction(
    {
      id: "parallel-test",
      triggers: [{ event: "examples/104-httpapi-parallel-steps/examples/104/demo/parallel" }],
    },
    async ({ event, step }) => {
      const a = typeof event.data.a === "number" ? event.data.a : 0;
      const b = typeof event.data.b === "number" ? event.data.b : 0;
      const [sum, product] = await Promise.all([step.run("sum", () => a + b), step.run("product", () => a * b)]);
      return { sum, product };
    },
  );

  return {
    id: "104-httpapi-parallel-steps",
    functions: [ParallelTest],
    cases: [
      eventCase({
        events: [{ name: "examples/104-httpapi-parallel-steps/examples/104/demo/parallel", data: { a: 6, b: 7 } }],
        expect: [{ functionId: "examples-104-httpapi-parallel-steps-parallel-test" }],
      }),
    ],
  };
});
