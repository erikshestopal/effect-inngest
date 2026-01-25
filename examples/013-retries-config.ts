import { FetchHttpClient } from "@effect/platform";
import { BunHttpServer, BunRuntime } from "@effect/platform-bun";
import * as HttpMiddleware from "@effect/platform/HttpMiddleware";
import * as HttpServer from "@effect/platform/HttpServer";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import { InngestClient, InngestFunction, InngestGroup } from "effect-inngest";

class IntentionalFailure extends Schema.TaggedError<IntentionalFailure>()("IntentionalFailure", {
  message: Schema.String,
}) {}

class DemoRetriesLimited extends Schema.TaggedClass<DemoRetriesLimited>()("demo/retries-limited", {}) {}

const RetriesLimitedFn = InngestFunction.make("retries-limited", {
  trigger: { event: DemoRetriesLimited },
  success: Schema.Struct({ success: Schema.Boolean }),
  retries: 1,
});

const Group = InngestGroup.make(RetriesLimitedFn);

const HandlersLive = Group.toLayer({
  "retries-limited": ({ step }) =>
    step.run(
      "always-fail",
      Effect.gen(function* () {
        yield* Effect.log("Attempt failed - will retry");
        return yield* new IntentionalFailure({ message: "Intentional failure" });
      }),
    ),
});

const ClientLive = InngestClient.layer({
  id: "research-app",
  mode: "dev",
  apiBaseUrl: "http://127.0.0.1:8288",
  eventBaseUrl: "http://127.0.0.1:8288",
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
