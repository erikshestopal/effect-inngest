import { FetchHttpClient } from "@effect/platform";
import { BunHttpServer, BunRuntime } from "@effect/platform-bun";
import * as HttpMiddleware from "@effect/platform/HttpMiddleware";
import * as HttpServer from "@effect/platform/HttpServer";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import { InngestClient, InngestFunction, InngestGroup } from "effect-inngest";

class DemoConditional extends Schema.TaggedClass<DemoConditional>()("demo/conditional", {
  shouldSkip: Schema.Boolean,
}) {}

const ConditionalFn = InngestFunction.make("conditional-steps", {
  trigger: { event: DemoConditional },
  success: Schema.Struct({
    path: Schema.String,
    result: Schema.String,
  }),
});

const Group = InngestGroup.make(ConditionalFn);

const HandlersLive = Group.toLayer({
  "conditional-steps": ({ event, step }) =>
    Effect.gen(function* () {
      yield* step.run("setup", Effect.succeed("initialized"));

      if (event.shouldSkip) {
        const quickResult = yield* step.run("quick-path", Effect.succeed("skipped heavy work"));
        return { path: "quick", result: quickResult };
      } else {
        const step1 = yield* step.run("heavy-step-1", Effect.succeed("processed-1"));
        const step2 = yield* step.run("heavy-step-2", Effect.succeed("processed-2"));
        const step3 = yield* step.run("heavy-step-3", Effect.succeed("processed-3"));
        return { path: "full", result: `${step1},${step2},${step3}` };
      }
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
