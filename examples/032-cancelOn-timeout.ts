import { FetchHttpClient } from "effect/unstable/http";
import { BunHttpServer, BunRuntime } from "@effect/platform-bun";
import * as HttpMiddleware from "effect/unstable/http/HttpMiddleware";
import * as HttpServer from "effect/unstable/http/HttpServer";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import { InngestClient, InngestFunction, InngestGroup } from "effect-inngest";

class JobStarted extends Schema.TaggedClass<JobStarted>()("job/started", {
  jobId: Schema.String,
}) {}

export class JobCancelled extends Schema.TaggedClass<JobCancelled>()("job/cancelled", {
  jobId: Schema.String,
}) {}

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
      yield* step.run("start", Effect.succeed(`Starting job ${event.jobId}`));
      yield* step.sleep("work-phase-1", Duration.seconds(2));
      yield* step.run("progress", Effect.succeed("30% complete"));
      yield* step.sleep("work-phase-2", Duration.seconds(2));
      yield* step.run("almost-done", Effect.succeed("60% complete"));
      yield* step.sleep("work-phase-3", Duration.seconds(2));
      return { status: "completed", jobId: event.jobId };
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
