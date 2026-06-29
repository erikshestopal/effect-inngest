import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { InngestEvent, InngestFunction, InngestGroup } from "effect-inngest";
import { defineExample, eventCase } from "./_support.ts";

const Started = InngestEvent.make(
  "examples/069-cancelOn-event-definition/task/started",
  Schema.Struct({ taskId: Schema.String }),
);

const Cancelled = InngestEvent.make(
  "examples/069-cancelOn-event-definition/task/cancelled",
  Schema.Struct({ taskId: Schema.String }),
);

const CancellableTask = InngestFunction.make("cancellable-task", {
  trigger: { event: Started },
  cancelOn: [{ event: Cancelled, if: "async.data.taskId == event.data.taskId" }],
});

const Group = InngestGroup.make(CancellableTask);

const HandlersLive = Group.toLayer({
  "cancellable-task": ({ event, step }) =>
    Effect.gen(function* () {
      yield* step.run("record-start", Effect.succeed(event.data.taskId));
      return { taskId: event.data.taskId, status: "completed" };
    }),
});

export default defineExample({
  id: "069-cancelOn-event-definition",
  group: Group,
  handlers: HandlersLive,
  cases: [
    eventCase({
      events: [
        {
          name: "examples/069-cancelOn-event-definition/task/started",
          data: { taskId: "task-069" },
        },
      ],
      expect: [{ functionTag: "cancellable-task", spans: ["record-start"] }],
    }),
  ],
});
