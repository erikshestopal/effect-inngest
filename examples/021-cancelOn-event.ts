import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { InngestFunction, InngestGroup, InngestEvent } from "effect-inngest";
import { defineExample, eventCase } from "./_support.ts";

const TaskStarted = InngestEvent.make(
  "examples/021-cancelOn-event/task/started",
  Schema.Struct({
    taskId: Schema.String,
  }),
);

export const TaskCancelled = InngestEvent.make(
  "examples/021-cancelOn-event/task/cancelled",
  Schema.Struct({
    taskId: Schema.String,
  }),
);

const LongTaskFn = InngestFunction.make("long-task", {
  trigger: { event: TaskStarted },
  cancelOn: [{ event: TaskCancelled, if: "async.data.taskId == event.data.taskId" }],
  success: Schema.Struct({ status: Schema.String }),
});

const Group = InngestGroup.make(LongTaskFn);

const HandlersLive = Group.toLayer({
  "long-task": ({ event, step }) =>
    Effect.gen(function* () {
      yield* step.run("step-1", Effect.succeed(`Started task ${event.data.taskId}`), { schema: Schema.String });
      yield* step.sleep("wait-1", Duration.seconds(3));
      yield* step.run("step-2", Effect.succeed("Still running..."), { schema: Schema.String });
      yield* step.sleep("wait-2", Duration.seconds(3));
      yield* step.run("step-3", Effect.succeed("Almost done..."), { schema: Schema.String });
      return { status: "completed" };
    }),
});

export default defineExample({
  id: "021-cancelOn-event",
  group: Group,
  handlers: HandlersLive,
  cases: [
    eventCase({
      events: [
        {
          name: "examples/021-cancelOn-event/task/started",
          data: {
            taskId: "task-021",
          },
        },
      ],
      expect: [
        {
          spans: ["step-1", "wait-1", "step-2", "wait-2", "step-3"],
          functionTag: "long-task",
        },
      ],
      timeoutMs: 30000,
    }),
  ],
});
