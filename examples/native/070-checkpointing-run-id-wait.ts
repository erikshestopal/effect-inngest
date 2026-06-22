import { defineNativeExample, eventCase } from "./_support.ts";
import * as Predicate from "effect/Predicate";

export default defineNativeExample((inngest) => {
  const Fn = inngest.createFunction(
    {
      id: "checkpoint-run-id-wait",
      triggers: [{ event: "examples/070-checkpointing-run-id-wait/demo/start" }],
      checkpointing: { bufferedSteps: 1 },
    },
    async ({ event, step }) => {
      const extractionId = Predicate.isString(event.data.extractionId) ? event.data.extractionId : "missing";
      const runId = await step.run("submit-extraction", () => extractionId);
      const completed = await step.waitForEvent("wait-for-extraction", {
        event: "examples/070-checkpointing-run-id-wait/demo/completed",
        timeout: "30s",
        if: `async.data.runId == ${JSON.stringify(runId)}`,
      });
      const finalizedRunId = await step.run("finalize-extraction", () => {
        return completed && Predicate.isString(completed.data.runId) ? completed.data.runId : "missing";
      });
      return { finalizedRunId, submittedRunId: runId };
    },
  );

  return {
    id: "070-checkpointing-run-id-wait",
    functions: [Fn],
    cases: [
      eventCase({
        eventKey: "test",
        events: [
          {
            name: "examples/070-checkpointing-run-id-wait/demo/start",
            data: { extractionId: "exr_070_current" },
          },
        ],
        afterEvents: [
          {
            delayMs: 1000,
            eventKey: "test",
            events: [
              {
                name: "examples/070-checkpointing-run-id-wait/demo/completed",
                data: { runId: "exr_070_current" },
              },
            ],
          },
        ],
        expect: [{ functionId: "examples-070-checkpointing-run-id-wait-checkpoint-run-id-wait" }],
      }),
    ],
  };
});
