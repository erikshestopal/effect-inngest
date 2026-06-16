import { defineNativeExample, eventCase } from "./_support.ts";

export default defineNativeExample((inngest) => {
  const CancellableJob = inngest.createFunction(
    {
      id: "cancellable-job",
      triggers: [{ event: "examples/032-cancelOn-timeout/job/started" }],
      cancelOn: [
        {
          event: "examples/032-cancelOn-timeout/job/cancelled",
          if: "async.data.jobId == event.data.jobId",
          timeout: "60s",
        },
      ],
    },
    async ({ event, step }) => {
      const jobId = typeof event.data.jobId === "string" ? event.data.jobId : "";
      await step.run("start", () => `Starting job ${jobId}`);
      await step.sleep("work-phase-1", "2s");
      await step.run("progress", () => "30% complete");
      await step.sleep("work-phase-2", "2s");
      await step.run("almost-done", () => "60% complete");
      await step.sleep("work-phase-3", "2s");
      return { status: "completed", jobId };
    },
  );

  return {
    id: "032-cancelOn-timeout",
    functions: [CancellableJob],
    cases: [
      eventCase({
        events: [{ name: "examples/032-cancelOn-timeout/job/started", data: { jobId: "job-032" } }],
        expect: [{ functionId: "examples-032-cancelOn-timeout-cancellable-job" }],
      }),
    ],
  };
});
