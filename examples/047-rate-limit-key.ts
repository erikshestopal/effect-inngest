import { FetchHttpClient } from "@effect/platform";
import { BunHttpServer, BunRuntime } from "@effect/platform-bun";
import * as HttpMiddleware from "@effect/platform/HttpMiddleware";
import * as HttpServer from "@effect/platform/HttpServer";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import { InngestClient, InngestFunction, InngestGroup } from "effect-inngest";

class DemoRateKeyed extends Schema.TaggedClass<DemoRateKeyed>()("demo/rate-keyed", {
  companyId: Schema.String,
}) {}

const RateLimitKeyedFn = InngestFunction.make("rate-limit-keyed", {
  trigger: { event: DemoRateKeyed },
  success: Schema.Struct({ companyId: Schema.String, processedAt: Schema.String }),
  rateLimit: {
    limit: 2,
    period: "1 minute",
    key: "event.data.companyId",
  },
});

const Group = InngestGroup.make(RateLimitKeyedFn);

const HandlersLive = Group.toLayer({
  "rate-limit-keyed": ({ event }) =>
    Effect.gen(function* () {
      yield* Effect.log(`Processing rate-limited event for company: ${event.companyId}`);
      return {
        companyId: event.companyId,
        processedAt: new Date().toISOString(),
      };
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
