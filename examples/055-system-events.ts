import { FetchHttpClient } from "effect/unstable/http";
import { BunHttpServer, BunRuntime } from "@effect/platform-bun";
import * as HttpMiddleware from "effect/unstable/http/HttpMiddleware";
import * as HttpServer from "effect/unstable/http/HttpServer";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import { InngestClient, InngestEvents, InngestFunction, InngestGroup } from "effect-inngest";

class DemoTriggerFailure extends Schema.TaggedClass<DemoTriggerFailure>()("demo/trigger-failure", {
  shouldFail: Schema.Boolean,
}) {}

class IntentionalFailure extends Schema.TaggedErrorClass<IntentionalFailure>()("IntentionalFailure", {
  message: Schema.String,
}) {}

const TriggerFailure = InngestFunction.make("trigger-failure", {
  trigger: { event: DemoTriggerFailure },
  success: Schema.Void,
  retries: 0,
});

const HandleFailure = InngestFunction.make("handle-failure", {
  trigger: { event: InngestEvents.FunctionFailed },
  success: Schema.Struct({ handled: Schema.Boolean, failedFunctionId: Schema.String }),
});

const TrackCompletion = InngestFunction.make("track-completion", {
  trigger: { event: InngestEvents.FunctionFinishedSuccess },
  success: Schema.Struct({ tracked: Schema.Boolean }),
});

const HandleCancellation = InngestFunction.make("handle-cancellation", {
  trigger: { event: InngestEvents.FunctionCancelled },
  success: Schema.Struct({ cleanedUp: Schema.Boolean }),
});

const Group = InngestGroup.make(TriggerFailure, HandleFailure, TrackCompletion, HandleCancellation);

const HandlersLive = Group.toLayer({
  "trigger-failure": ({ event }) =>
    Effect.gen(function* () {
      if (event.shouldFail) {
        return yield* new IntentionalFailure({ message: "Intentional failure for testing" });
      }
    }),

  "handle-failure": ({ event }) =>
    Effect.gen(function* () {
      yield* Effect.log(`Function ${event.function_id} failed with error: ${event.error.message}`);
      yield* Effect.log(`Original event: ${JSON.stringify(event.event)}`);
      return { handled: true, failedFunctionId: event.function_id };
    }),

  "track-completion": ({ event }) =>
    Effect.gen(function* () {
      yield* Effect.log(`Function ${event.function_id} completed successfully`);
      yield* Effect.log(`Result: ${JSON.stringify(event.result)}`);
      return { tracked: true };
    }),

  "handle-cancellation": ({ event }) =>
    Effect.gen(function* () {
      yield* Effect.log(`Function ${event.function_id} was cancelled`);
      return { cleanedUp: true };
    }),
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
