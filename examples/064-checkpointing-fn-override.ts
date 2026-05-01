/**
 * Spec §10.1.1 — function-level checkpointing overrides the client default.
 *
 * Client sets `bufferedSteps: 5`; this function overrides to `bufferedSteps: 1`,
 * so every step is flushed immediately. Verify registration sends a per-function
 * `checkpoint.batch_steps: 1`, and the dev-server timeline shows one checkpoint
 * per step rather than one per batch.
 */
import { FetchHttpClient } from "effect/unstable/http";
import { BunHttpServer, BunRuntime } from "@effect/platform-bun";
import * as HttpMiddleware from "effect/unstable/http/HttpMiddleware";
import * as HttpServer from "effect/unstable/http/HttpServer";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import { InngestClient, InngestFunction, InngestGroup } from "effect-inngest";

class OverrideEvent extends Schema.TaggedClass<OverrideEvent>()("demo/checkpoint-override", {
  key: Schema.String,
}) {}

const Fn = InngestFunction.make("checkpoint-override", {
  trigger: { event: OverrideEvent },
  success: Schema.Struct({ key: Schema.String }),
  // Overrides client-level `bufferedSteps: 5` → flush-per-step.
  checkpointing: { bufferedSteps: 1 },
});

const Group = InngestGroup.make(Fn);

const HandlersLive = Group.toLayer({
  "checkpoint-override": ({ event, step }) =>
    Effect.gen(function* () {
      yield* step.run("a", Effect.succeed("A"));
      yield* step.run("b", Effect.succeed("B"));
      yield* step.run("c", Effect.succeed("C"));
      return { key: event.key };
    }),
});

const ClientLive = InngestClient.layer({
  id: "research-app",
  mode: "dev",
  apiBaseUrl: "http://127.0.0.1:8288",
  eventKey: "test",
  // Client default — function above overrides it.
  checkpointing: { bufferedSteps: 5 },
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
