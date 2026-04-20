/**
 * Spec §10.4.1 #7 — `maxRuntime` deadline.
 *
 * Five `step.run` calls each taking ~200ms. With `maxRuntime: 500ms`, the
 * driver interrupts the handler after ~2-3 steps and emits `DiscoveryRequest`
 * so the executor re-invokes the function with the buffered results committed.
 * Verify in dev-server timeline that 5 step runs eventually complete across
 * multiple function call attempts.
 */
import { FetchHttpClient } from "effect/unstable/http";
import { BunHttpServer, BunRuntime } from "@effect/platform-bun";
import * as HttpMiddleware from "effect/unstable/http/HttpMiddleware";
import * as HttpServer from "effect/unstable/http/HttpServer";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import { InngestClient, InngestFunction, InngestGroup } from "effect-inngest";

class DeadlineEvent extends Schema.TaggedClass<DeadlineEvent>()("demo/checkpoint-deadline", {
  runId: Schema.String,
}) {}

const Fn = InngestFunction.make("checkpoint-deadline", {
  trigger: { event: DeadlineEvent },
  success: Schema.Struct({ count: Schema.Number }),
  checkpointing: { bufferedSteps: 1, maxRuntime: "500 millis" },
});

const Group = InngestGroup.make(Fn);

const HandlersLive = Group.toLayer({
  "checkpoint-deadline": ({ step }) =>
    Effect.gen(function* () {
      const slow = (label: string) => Effect.as(Effect.sleep("200 millis"), label);
      yield* step.run("s1", slow("s1"));
      yield* step.run("s2", slow("s2"));
      yield* step.run("s3", slow("s3"));
      yield* step.run("s4", slow("s4"));
      yield* step.run("s5", slow("s5"));
      return { count: 5 };
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
