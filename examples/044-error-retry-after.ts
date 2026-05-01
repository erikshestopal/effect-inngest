import { FetchHttpClient } from "effect/unstable/http";
import { BunHttpServer, BunRuntime } from "@effect/platform-bun";
import * as HttpMiddleware from "effect/unstable/http/HttpMiddleware";
import * as HttpServer from "effect/unstable/http/HttpServer";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import { InngestClient, InngestFunction, InngestGroup } from "effect-inngest";
import { RetryAfterError } from "effect-inngest";

class DemoRetryAfter extends Schema.TaggedClass<DemoRetryAfter>()("demo/retry-after", {}) {}

const RetryAfterFn = InngestFunction.make("retry-after-demo", {
  trigger: { event: DemoRetryAfter },
  success: Schema.Struct({ attempt: Schema.Number, succeeded: Schema.Boolean }),
});

const Group = InngestGroup.make(RetryAfterFn);

let attemptCount = 0;

const HandlersLive = Group.toLayer({
  "retry-after-demo": () =>
    Effect.gen(function* () {
      attemptCount++;
      yield* Effect.log(`Attempt ${attemptCount}...`);

      if (attemptCount < 3) {
        yield* Effect.log(`Rate limited, scheduling retry in 30 seconds...`);
        return yield* Effect.fail(
          new RetryAfterError({
            message: "Rate limited by external API",
            retryAfter: Duration.seconds(1),
          }),
        );
      }

      yield* Effect.log("Success on attempt 3!");
      return { attempt: attemptCount, succeeded: true };
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
