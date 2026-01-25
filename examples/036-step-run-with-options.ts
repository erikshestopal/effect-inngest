import { FetchHttpClient } from "@effect/platform";
import { BunHttpServer, BunRuntime } from "@effect/platform-bun";
import * as HttpMiddleware from "@effect/platform/HttpMiddleware";
import * as HttpServer from "@effect/platform/HttpServer";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import { InngestClient, InngestFunction, InngestGroup } from "effect-inngest";

class DemoStepOptions extends Schema.TaggedClass<DemoStepOptions>()("demo/step-options", {}) {}

const StepOptionsFn = InngestFunction.make("step-options-demo", {
  trigger: { event: DemoStepOptions },
  success: Schema.Struct({ results: Schema.Array(Schema.String) }),
});

const Group = InngestGroup.make(StepOptionsFn);

const HandlersLive = Group.toLayer({
  "step-options-demo": ({ step }) =>
    Effect.gen(function* () {
      const result1 = yield* step.run("basic-step", Effect.succeed("basic"));

      const result2 = yield* step.run({ id: "named-step", name: "Named Step" }, Effect.succeed("with-name"));

      const result3 = yield* step.run("third-step", Effect.succeed("completed"));

      return { results: [result1, result2, result3] };
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
