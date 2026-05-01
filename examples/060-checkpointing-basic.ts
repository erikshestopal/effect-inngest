/**
 * Spec §10.4.1 — async checkpointing with default config.
 *
 * Three sequential `step.run` calls. With `bufferedSteps: 1` (default), each
 * step is flushed via POST /v1/checkpoint/{runId}/async. The final 206 carries
 * only `RunComplete` — verify in the dev-server timeline that the run completes
 * after a single Call Request rather than N round trips.
 */
import { FetchHttpClient } from "effect/unstable/http";
import { BunHttpServer, BunRuntime } from "@effect/platform-bun";
import * as HttpMiddleware from "effect/unstable/http/HttpMiddleware";
import * as HttpServer from "effect/unstable/http/HttpServer";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import { InngestClient, InngestFunction, InngestGroup } from "effect-inngest";

class BasicEvent extends Schema.TaggedClass<BasicEvent>()("demo/checkpoint-basic", {
  value: Schema.Number,
}) {}

const Fn = InngestFunction.make("checkpoint-basic", {
  trigger: { event: BasicEvent },
  success: Schema.Struct({ doubled: Schema.Number, tripled: Schema.Number, total: Schema.Number }),
});

const Group = InngestGroup.make(Fn);

const HandlersLive = Group.toLayer({
  "checkpoint-basic": ({ event, step }) =>
    Effect.gen(function* () {
      const doubled = yield* step.run("double", Effect.succeed(event.value * 2));
      const tripled = yield* step.run("triple", Effect.succeed(event.value * 3));
      const total = yield* step.run("sum", Effect.succeed(doubled + tripled));
      return { doubled, tripled, total };
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
