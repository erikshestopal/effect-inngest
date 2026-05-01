import { FetchHttpClient } from "effect/unstable/http";
import { BunHttpServer, BunRuntime } from "@effect/platform-bun";
import * as HttpMiddleware from "effect/unstable/http/HttpMiddleware";
import * as HttpServer from "effect/unstable/http/HttpServer";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import { InngestClient, InngestFunction, InngestGroup } from "effect-inngest";

class DemoEcho extends Schema.TaggedClass<DemoEcho>()("demo/echo", {
  message: Schema.String,
}) {}

const EchoFn = InngestFunction.make("echo-data", {
  trigger: { event: DemoEcho },
  success: Schema.Struct({ received: Schema.String }),
});

const Group = InngestGroup.make(EchoFn);

const HandlersLive = Group.toLayer({
  "echo-data": ({ event }) =>
    Effect.gen(function* () {
      yield* Effect.log(`echo-data received: ${event.message}`);
      return { received: event.message };
    }).pipe(Effect.withSpan("example/echo-data")),
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
