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

class DemoRetryError extends Schema.TaggedClass<DemoRetryError>()("demo/retry-error", {}) {}

const RetryFn = InngestFunction.make("retry-demo", {
  trigger: { event: DemoRetryError },
  retries: 5,
  success: Schema.Struct({ attempts: Schema.Number }),
});

const Group = InngestGroup.make(RetryFn);

const HandlersLive = Group.toLayer({
  "retry-demo": ({ step, run }) =>
    Effect.gen(function* () {
      const attempt = run.attempt;
      const result = yield* step.run(
        "flaky-step",
        Effect.gen(function* () {
          yield* Effect.log(`Flaky step running, attempt: ${attempt}`);
          if (attempt < 1) {
            yield* Effect.log(`Failing attempt ${attempt}, will retry in 1s`);
            return yield* Effect.fail(
              new RetryAfterError({
                message: `Attempt ${attempt} failed`,
                retryAfter: Duration.seconds(1),
              }),
            );
          }
          yield* Effect.log(`Success on attempt ${attempt}`);
          return attempt + 1;
        }),
      );
      return { attempts: result };
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
