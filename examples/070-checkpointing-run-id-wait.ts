import { defineExample, eventCase } from "./_support.ts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { InngestFunction, InngestGroup, InngestEvent, Inngest } from "effect-inngest";

const StartEvent = InngestEvent.make(
  "examples/070-checkpointing-run-id-wait/demo/start",
  Schema.Struct({
    extractionId: Schema.String,
  }),
);

const CompletedEvent = InngestEvent.make(
  "examples/070-checkpointing-run-id-wait/demo/completed",
  Schema.Struct({
    runId: Schema.String,
  }),
);

const Fn = InngestFunction.make("checkpoint-run-id-wait", {
  trigger: { event: StartEvent },
  checkpointing: { bufferedSteps: 1 },
});

const Group = InngestGroup.make(Fn);

const HandlersLive = Group.toLayer({
  "checkpoint-run-id-wait": ({ event }) =>
    Effect.gen(function* () {
      const runId = yield* Inngest.run("submit-extraction", Effect.succeed(event.data.extractionId));
      const completed = yield* Inngest.waitForEvent("wait-for-extraction", CompletedEvent, {
        timeout: "30 seconds",
        if: `async.data.runId == ${JSON.stringify(runId)}`,
      });
      const finalizedRunId = yield* Inngest.run(
        "finalize-extraction",
        Effect.succeed(Option.isSome(completed) ? completed.value.data.runId : "missing"),
      );
      return { finalizedRunId, submittedRunId: runId };
    }),
});

export default defineExample({
  id: "070-checkpointing-run-id-wait",
  group: Group,
  handlers: HandlersLive,
  cases: [
    eventCase({
      eventKey: "test",
      events: [
        {
          name: "examples/070-checkpointing-run-id-wait/demo/start",
          data: {
            extractionId: "exr_070_current",
          },
        },
      ],
      afterEvents: [
        {
          delayMs: 1000,
          eventKey: "test",
          events: [
            {
              name: "examples/070-checkpointing-run-id-wait/demo/completed",
              data: {
                runId: "exr_070_current",
              },
            },
          ],
        },
      ],
      expect: [
        {
          spans: ["submit-extraction", "wait-for-extraction", "finalize-extraction"],
          functionTag: "checkpoint-run-id-wait",
        },
      ],
      timeoutMs: 30000,
    }),
  ],
});
