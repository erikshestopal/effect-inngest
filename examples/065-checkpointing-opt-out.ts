/**
 * Spec §10.1.1 — function-level opt-out with `checkpointing: false`.
 *
 * Even though the client has checkpointing enabled (default-on), this
 * function opts out. Verify in the dev-server timeline that each step is a
 * classic 206-per-step round trip, no `/v1/checkpoint/{runId}/async` POSTs,
 * and the registration payload omits the `checkpoint` block for this function.
 */
import { FetchHttpClient } from "effect/unstable/http";
import { BunHttpServer, BunRuntime } from "@effect/platform-bun";
import * as HttpMiddleware from "effect/unstable/http/HttpMiddleware";
import * as HttpServer from "effect/unstable/http/HttpServer";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import { InngestClient, InngestFunction, InngestGroup } from "effect-inngest";

class OptOutEvent extends Schema.TaggedClass<OptOutEvent>()("demo/checkpoint-opt-out", {
  tag: Schema.String,
}) {}

const Fn = InngestFunction.make("checkpoint-opt-out", {
  trigger: { event: OptOutEvent },
  success: Schema.Struct({ tag: Schema.String }),
  checkpointing: false,
});

const Group = InngestGroup.make(Fn);

const HandlersLive = Group.toLayer({
  "checkpoint-opt-out": ({ event, step }) =>
    Effect.gen(function* () {
      yield* step.run("a", Effect.succeed("A"));
      yield* step.run("b", Effect.succeed("B"));
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
