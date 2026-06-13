import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { InngestFunction, InngestGroup } from "effect-inngest";
import { defineExample, eventCase } from "./_support.ts";

class DemoOrchestrate extends Schema.TaggedClass<DemoOrchestrate>()("demo/orchestrate", {
  taskId: Schema.String,
}) {}

class DemoWorkerTask extends Schema.TaggedClass<DemoWorkerTask>()("demo/worker-task", {
  taskId: Schema.String,
  priority: Schema.optional(Schema.Literals(["low", "normal", "high"])),
}) {}

const WorkerFn = InngestFunction.make("worker-task", {
  trigger: { event: DemoWorkerTask },
  retries: 3,
  success: Schema.Struct({ completed: Schema.Boolean, taskId: Schema.String }),
});

const OrchestratorFn = InngestFunction.make("orchestrator", {
  trigger: { event: DemoOrchestrate },
  success: Schema.Struct({
    orchestrated: Schema.Boolean,
    workerResult: Schema.Unknown,
    batchResult: Schema.Unknown,
  }),
});

const Group = InngestGroup.make(WorkerFn, OrchestratorFn);

const HandlersLive = Group.toLayer({
  "worker-task": ({ event }) =>
    Effect.gen(function* () {
      yield* Effect.log(`Worker processing task: ${event.taskId}, priority: ${event.priority ?? "normal"}`);
      yield* Effect.sleep(Duration.millis(100));
      return { completed: true, taskId: event.taskId };
    }),

  orchestrator: ({ event, step }) =>
    Effect.gen(function* () {
      yield* Effect.log(`Orchestrating task: ${event.taskId}`);

      const result = yield* step.invoke("invoke-worker", {
        function: WorkerFn,
        data: { taskId: event.taskId, priority: "high" as const } as never,
        timeout: Duration.seconds(30),
      });

      yield* Effect.log(`Worker completed: ${JSON.stringify(result)}`);

      const batchResult = yield* step.invoke("invoke-batch-worker", {
        function: WorkerFn,
        data: { taskId: `${event.taskId}-batch`, priority: "low" as const } as never,
        timeout: Duration.minutes(5),
      });

      return {
        orchestrated: true,
        workerResult: result,
        batchResult,
      };
    }),
});

export default defineExample({
  id: "053-step-invoke-options",
  group: Group,
  handlers: HandlersLive,
  cases: [
    eventCase({
      eventKey: "test",
      events: [
        {
          name: "demo/orchestrate",
          data: {
            taskId: "task-053",
          },
        },
      ],
      expect: [
        {
          spans: ["invoke-worker", "invoke-batch-worker"],
          functionTag: "orchestrator",
        },
      ],
      timeoutMs: 40000,
    }),
  ],
});
