import { FetchHttpClient } from "@effect/platform";
import { BunHttpServer, BunRuntime } from "@effect/platform-bun";
import * as HttpMiddleware from "@effect/platform/HttpMiddleware";
import * as HttpServer from "@effect/platform/HttpServer";
import * as Duration from "effect/Duration";
import * as Layer from "effect/Layer";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { InngestClient, InngestFunction, InngestGroup } from "effect-inngest";

class TaskStarted extends Schema.TaggedClass<TaskStarted>()("task/started", {
  taskId: Schema.String,
}) {}

export class TaskCancelled extends Schema.TaggedClass<TaskCancelled>()("task/cancelled", {
  taskId: Schema.String,
}) {}

const LongTaskFn = InngestFunction.make("long-task", {
  trigger: { event: TaskStarted },
  cancelOn: [{ event: "task/cancelled", if: "async.data.taskId == event.data.taskId" }],
  success: Schema.Struct({ status: Schema.String }),
});

const Group = InngestGroup.make(LongTaskFn);

const HandlersLive = Group.toLayer({
  "long-task": ({ event, step }) =>
    Effect.gen(function* () {
      yield* step.run("step-1", Effect.succeed(`Started task ${event.taskId}`));
      yield* step.sleep("wait-1", Duration.seconds(3));
      yield* step.run("step-2", Effect.succeed("Still running..."));
      yield* step.sleep("wait-2", Duration.seconds(3));
      yield* step.run("step-3", Effect.succeed("Almost done..."));
      return { status: "completed" };
    }),
});

const ClientLive = InngestClient.layer({
  id: "research-app",
  mode: "dev",
  apiBaseUrl: "http://127.0.0.1:8288",
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
