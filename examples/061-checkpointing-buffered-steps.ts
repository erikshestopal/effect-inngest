/**
 * Spec §10.1.2 — `bufferedSteps: 2` batches 2 steps per checkpoint POST.
 *
 * Four sequential `step.run` calls. Steps 1+2 are flushed together, 3+4 are
 * flushed together. The final 206 ends with `RunComplete` (no buffered
 * remainder). Verify the dev-server timeline shows 2 checkpoint batches.
 */
import { FetchHttpClient } from "effect/unstable/http";
import { BunHttpServer, BunRuntime } from "@effect/platform-bun";
import * as HttpMiddleware from "effect/unstable/http/HttpMiddleware";
import * as HttpServer from "effect/unstable/http/HttpServer";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import { InngestClient, InngestFunction, InngestGroup } from "effect-inngest";

class BufferedEvent extends Schema.TaggedClass<BufferedEvent>()("demo/checkpoint-buffered", {
  base: Schema.Number,
}) {}

const Fn = InngestFunction.make("checkpoint-buffered", {
  trigger: { event: BufferedEvent },
  success: Schema.Struct({ total: Schema.Number }),
  checkpointing: { bufferedSteps: 2 },
});

const Group = InngestGroup.make(Fn);

const HandlersLive = Group.toLayer({
  "checkpoint-buffered": ({ event, step }) =>
    Effect.gen(function* () {
      const a = yield* step.run("a", Effect.succeed(event.base + 1));
      const b = yield* step.run("b", Effect.succeed(event.base + 2));
      const c = yield* step.run("c", Effect.succeed(event.base + 3));
      const d = yield* step.run("d", Effect.succeed(event.base + 4));
      return { total: a + b + c + d };
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
