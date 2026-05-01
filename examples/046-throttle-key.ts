import { FetchHttpClient } from "effect/unstable/http";
import { BunHttpServer, BunRuntime } from "@effect/platform-bun";
import * as HttpMiddleware from "effect/unstable/http/HttpMiddleware";
import * as HttpServer from "effect/unstable/http/HttpServer";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import { InngestClient, InngestFunction, InngestGroup } from "effect-inngest";

class DemoThrottleKeyed extends Schema.TaggedClass<DemoThrottleKeyed>()("demo/throttle-keyed", {
  teamId: Schema.String,
}) {}

const ThrottleKeyedFn = InngestFunction.make("throttle-keyed", {
  trigger: { event: DemoThrottleKeyed },
  success: Schema.Struct({ teamId: Schema.String, processedAt: Schema.String }),
  throttle: {
    limit: 1,
    period: "1 second",
    key: "event.data.teamId",
  },
});

const Group = InngestGroup.make(ThrottleKeyedFn);

const HandlersLive = Group.toLayer({
  "throttle-keyed": ({ event }) =>
    Effect.gen(function* () {
      yield* Effect.log(`Processing throttled event for team: ${event.teamId}`);
      return {
        teamId: event.teamId,
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
