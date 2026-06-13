import { defineNativeExample, eventCase } from "./_support.ts";

export default defineNativeExample((inngest) => {
  const ParallelMixedFn = inngest.createFunction(
    {
      id: "parallel-mixed",
      triggers: [{ event: "demo/parallel-mixed" }],
    },
    async ({ step, logger }) => {
      logger.info("Starting parallel mixed steps...");

      const [computed] = await Promise.all([
        step.run("compute", () => 42),
        step.sleep("short-wait", "2s"),
        step.sendEvent("notify", { name: "demo/side-effect", data: { source: "parallel-mixed-function" } }),
      ]);

      logger.info(`Parallel steps complete! Computed: ${computed}`);
      return { computed, slept: true, sent: true };
    },
  );

  return {
    id: "043-parallel-mixed",
    functions: [ParallelMixedFn],
    cases: [
      eventCase({
        eventKey: "test",
        events: [{ name: "demo/parallel-mixed", data: {} }],
        expect: [{ functionId: "examples-043-parallel-mixed-parallel-mixed" }],
      }),
    ],
  };
});
