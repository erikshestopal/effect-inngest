/**
 * Spec §10.4.1 — async opcodes (Sleep, WaitForEvent, Invoke) force a buffer
 * flush before yielding. Here 2 buffered `step.run` results are checkpointed
 * prior to the `step.sleep` opcode, so the executor sees them durably before
 * the sleep schedule.
 */
import { FetchHttpClient } from "effect/unstable/http";
import { BunHttpServer, BunRuntime } from "@effect/platform-bun";
import * as HttpMiddleware from "effect/unstable/http/HttpMiddleware";
import * as HttpServer from "effect/unstable/http/HttpServer";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import { InngestClient, InngestFunction, InngestGroup } from "effect-inngest";

class SleepEvent extends Schema.TaggedClass<SleepEvent>()("demo/checkpoint-sleep", {
  tag: Schema.String,
}) {}

const Fn = InngestFunction.make("checkpoint-sleep", {
  trigger: { event: SleepEvent },
  success: Schema.Struct({ tag: Schema.String }),
  // bufferedSteps high enough that the sleep-flush is what actually triggers
  // the checkpoint POST.
  checkpointing: { bufferedSteps: 10 },
});

const Group = InngestGroup.make(Fn);

const HandlersLive = Group.toLayer({
  "checkpoint-sleep": ({ event, step }) =>
    Effect.gen(function* () {
      yield* step.run("prepare-a", Effect.succeed("a"));
      yield* step.run("prepare-b", Effect.succeed("b"));
      yield* step.sleep("nap", "2 seconds");
      return { tag: event.tag };
    }),
});

const ClientLive = InngestClient.layer({
  id: "research-app",
  mode: "dev",
  apiBaseUrl: "http://127.0.0.1:8288",
  eventKey: "test",
  checkpointing: true,
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
