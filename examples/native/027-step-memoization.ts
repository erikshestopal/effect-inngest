import { defineNativeExample, eventCase } from "./_support.ts";

export default defineNativeExample((inngest) => {
  const Memoization = inngest.createFunction(
    {
      id: "memoization-demo",
      triggers: [{ event: "examples/027-step-memoization/demo/memoized" }],
    },
    async ({ step }) => {
      const timestamp = await step.run("capture-time", () => Date.now());
      const randomValue = await step.run("capture-random", () => Math.random());

      await step.sleep("checkpoint", "1s");

      await step.run("verify", () => {
        console.log(`Timestamp: ${timestamp}, Random: ${randomValue}`);
      });

      return { timestamp, randomValue };
    },
  );

  return {
    id: "027-step-memoization",
    functions: [Memoization],
    cases: [
      eventCase({
        events: [{ name: "examples/027-step-memoization/demo/memoized", data: {} }],
        expect: [{ functionId: "examples-027-step-memoization-memoization-demo" }],
      }),
    ],
  };
});
