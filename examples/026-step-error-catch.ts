import { FetchHttpClient } from "effect/unstable/http";
import { BunHttpServer, BunRuntime } from "@effect/platform-bun";
import * as HttpMiddleware from "effect/unstable/http/HttpMiddleware";
import * as HttpServer from "effect/unstable/http/HttpServer";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import { InngestClient, InngestFunction, InngestGroup } from "effect-inngest";

class StepError extends Schema.TaggedErrorClass<StepError>()("StepError", {
  message: Schema.String,
}) {}

class DemoStepCatch extends Schema.TaggedClass<DemoStepCatch>()("demo/step-catch", {}) {}

const StepCatchFn = InngestFunction.make("step-catch-handler", {
  trigger: { event: DemoStepCatch },
  success: Schema.Struct({ result: Schema.String }),
});

const Group = InngestGroup.make(StepCatchFn);

const HandlersLive = Group.toLayer({
  "step-catch-handler": ({ step }) =>
    Effect.gen(function* () {
      const result = yield* step
        .run("risky-step", Effect.fail(new StepError({ message: "Something went wrong" })))
        .pipe(
          Effect.catch((error) =>
            Effect.succeed(`Caught error: ${error instanceof Error ? error.message : "unknown"}`),
          ),
        );
      return { result };
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
