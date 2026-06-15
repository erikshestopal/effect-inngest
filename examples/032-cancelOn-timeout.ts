import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { InngestFunction, InngestGroup, InngestEvent } from "effect-inngest";
import { defineExample, eventCase } from "./_support.ts";

const JobStarted = InngestEvent.make(
  "job/started",
  Schema.Struct({
    jobId: Schema.String,
  }),
);

export const JobCancelled = InngestEvent.make(
  "job/cancelled",
  Schema.Struct({
    jobId: Schema.String,
  }),
);

const CancellableJobFn = InngestFunction.make("cancellable-job", {
  trigger: { event: JobStarted },
  cancelOn: [
    {
      event: "job/cancelled",
      if: "async.data.jobId == event.data.jobId",
      timeout: "60 seconds",
    },
  ],
  success: Schema.Struct({ status: Schema.String, jobId: Schema.String }),
});

const Group = InngestGroup.make(CancellableJobFn);

const HandlersLive = Group.toLayer({
  "cancellable-job": ({ event, step }) =>
    Effect.gen(function* () {
      yield* step.run("start", Effect.succeed(`Starting job ${event.data.jobId}`));
      yield* step.sleep("work-phase-1", Duration.seconds(2));
      yield* step.run("progress", Effect.succeed("30% complete"));
      yield* step.sleep("work-phase-2", Duration.seconds(2));
      yield* step.run("almost-done", Effect.succeed("60% complete"));
      yield* step.sleep("work-phase-3", Duration.seconds(2));
      return { status: "completed", jobId: event.data.jobId };
    }),
});

export default defineExample({
  id: "032-cancelOn-timeout",
  group: Group,
  handlers: HandlersLive,
  cases: [
    eventCase({
      events: [
        {
          name: "job/started",
          data: {
            jobId: "job-032",
          },
        },
      ],
      expect: [
        {
          spans: ["start", "work-phase-1", "progress", "work-phase-2", "almost-done", "work-phase-3"],
          functionTag: "cancellable-job",
        },
      ],
      timeoutMs: 30000,
    }),
  ],
});
