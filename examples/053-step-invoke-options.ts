import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { InngestFunction, InngestGroup, InngestEvent, Inngest } from "effect-inngest";
import { defineExample, eventCase } from "./_support.ts";

const DemoOrchestrate = InngestEvent.make(
  "examples/053-step-invoke-options/demo/orchestrate",
  Schema.Struct({
    taskId: Schema.String,
  }),
);

const DemoWorkerTask = InngestEvent.make(
  "examples/053-step-invoke-options/demo/worker-task",
  Schema.Struct({
    taskId: Schema.String,
    priority: Schema.optional(Schema.Literals(["low", "normal", "high"])),
  }),
);

const WorkerFn = InngestFunction.make("worker-task", {
  trigger: { event: DemoWorkerTask },
  retries: 3,
});

const OrchestratorFn = InngestFunction.make("orchestrator", {
  trigger: { event: DemoOrchestrate },
});

const Group = InngestGroup.make(WorkerFn, OrchestratorFn);

const HandlersLive = Group.toLayer({
  "worker-task": ({ event }) =>
    Effect.gen(function* () {
      yield* Effect.log(`Worker processing task: ${event.data.taskId}, priority: ${event.data.priority ?? "normal"}`);
      yield* Effect.sleep(Duration.millis(100));
      return { completed: true, taskId: event.data.taskId };
    }),

  orchestrator: ({ event }) =>
    Effect.gen(function* () {
      yield* Effect.log(`Orchestrating task: ${event.data.taskId}`);

      const result = yield* Inngest.invoke("invoke-worker", {
        function: WorkerFn,
        data: { taskId: event.data.taskId, priority: "high" as const } as never,
        timeout: Duration.seconds(30),
      });

      yield* Effect.log(`Worker completed: ${JSON.stringify(result)}`);

      const batchResult = yield* Inngest.invoke("invoke-batch-worker", {
        function: WorkerFn,
        data: { taskId: `${event.data.taskId}-batch`, priority: "low" as const } as never,
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
          name: "examples/053-step-invoke-options/demo/orchestrate",
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
