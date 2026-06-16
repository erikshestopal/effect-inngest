import { defineNativeExample, eventCase } from "./_support.ts";

export default defineNativeExample((inngest) => {
  const RetriesLimitedFn = inngest.createFunction(
    {
      id: "retries-limited",
      retries: 1,
      triggers: [{ event: "examples/013-retries-config/demo/retries-limited" }],
    },
    async ({ step, logger }) => {
      await step.run("always-fail", () => {
        logger.info("Attempt failed - will retry");
        throw new Error("Intentional failure");
      });
      return { success: true };
    },
  );

  return {
    id: "013-retries-config",
    functions: [RetriesLimitedFn],
    cases: [
      eventCase({
        events: [{ name: "examples/013-retries-config/demo/retries-limited", data: {} }],
        expect: [{ functionId: "examples-013-retries-config-retries-limited" }],
      }),
    ],
  };
});
