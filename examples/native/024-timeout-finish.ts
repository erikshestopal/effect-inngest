import { defineNativeExample, eventCase } from "./_support.ts";

export default defineNativeExample((inngest) => {
  const LongRunningFn = inngest.createFunction(
    {
      id: "long-running-task",
      triggers: [{ event: "demo/long-running" }],
      timeouts: { finish: "2s" },
    },
    async ({ step }) => {
      await step.run("work-1", async () => "Phase 1 done");
      await step.sleep("long-wait", "5s");
      await step.run("work-2", async () => "Phase 2 done");
      return { status: "completed" };
    },
  );

  return {
    id: "024-timeout-finish",
    functions: [LongRunningFn],
    cases: [
      eventCase({
        events: [{ name: "demo/long-running", data: {} }],
        expect: [{ functionId: "examples-024-timeout-finish-long-running-task" }],
      }),
    ],
  };
});
