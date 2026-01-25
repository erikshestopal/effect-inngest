import { FetchHttpClient } from "@effect/platform";
import { BunHttpServer, BunRuntime } from "@effect/platform-bun";
import * as HttpMiddleware from "@effect/platform/HttpMiddleware";
import * as HttpServer from "@effect/platform/HttpServer";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import { InngestClient, InngestFunction, InngestGroup } from "effect-inngest";

class DemoRateLimited extends Schema.TaggedClass<DemoRateLimited>()("demo/rate-limited", {
  id: Schema.String,
}) {}

const RateLimitedFn = InngestFunction.make("rate-limited-fn", {
  trigger: { event: DemoRateLimited },
  success: Schema.Struct({ id: Schema.String, processedAt: Schema.String }),
  rateLimit: { limit: 1, period: "1 second" },
});

const Group = InngestGroup.make(RateLimitedFn);

const HandlersLive = Group.toLayer({
  "rate-limited-fn": ({ event }) =>
    Effect.gen(function* () {
      yield* Effect.log(`Processing rate-limited event id: ${event.id}`);
      return { id: event.id, processedAt: new Date().toISOString() };
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
