import { FetchHttpClient } from "@effect/platform";
import { BunHttpServer, BunRuntime } from "@effect/platform-bun";
import * as HttpMiddleware from "@effect/platform/HttpMiddleware";
import * as HttpServer from "@effect/platform/HttpServer";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import { InngestClient, InngestFunction, InngestGroup } from "effect-inngest";

class DemoOrchestrate extends Schema.TaggedClass<DemoOrchestrate>()("demo/orchestrate", {
  taskId: Schema.String,
}) {}

class DemoWorkerTask extends Schema.TaggedClass<DemoWorkerTask>()("demo/worker-task", {
  taskId: Schema.String,
  priority: Schema.optionalWith(Schema.Literal("low", "normal", "high"), { default: () => "normal" as const }),
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
      yield* Effect.log(`Worker processing task: ${event.taskId}, priority: ${event.priority}`);
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

const ClientLive = InngestClient.layer({
  id: "demo-invoke-options",
  mode: "dev",
  apiBaseUrl: "http://127.0.0.1:8288",
  eventKey: "test",
}).pipe(Layer.provide(FetchHttpClient.layer));

HttpServer.serve(InngestGroup.toHttpApp(Group), HttpMiddleware.logger).pipe(
  HttpServer.withLogAddress,
  Layer.provide(BunHttpServer.layer({ port: 9999, hostname: "0.0.0.0" })),
  Layer.provide(HandlersLive),
  Layer.provide(ClientLive),
  Layer.provide(FetchHttpClient.layer),
  Layer.launch,
  BunRuntime.runMain,
);
