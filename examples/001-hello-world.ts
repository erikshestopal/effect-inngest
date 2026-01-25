import { FetchHttpClient } from "@effect/platform";
import { BunHttpServer, BunRuntime } from "@effect/platform-bun";
import * as HttpMiddleware from "@effect/platform/HttpMiddleware";
import * as HttpServer from "@effect/platform/HttpServer";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Logger from "effect/Logger";
import { Predicate } from "effect";
import * as Schema from "effect/Schema";
import { InngestClient, InngestFunction, InngestGroup } from "effect-inngest";

class DemoHello extends Schema.TaggedClass<DemoHello>()("demo/hello", {
  name: Schema.String,
}) {}

class DemoBye extends Schema.TaggedClass<DemoBye>()("demo/bye", {
  lastName: Schema.Number,
}) {}

const HelloFn = InngestFunction.make("hello-world", {
  trigger: [{ event: DemoHello }, { event: DemoBye }],
  success: Schema.Struct({ greeting: Schema.String }),
});

const Group = InngestGroup.make(HelloFn);

const HelloFnHandler = Group.toLayerHandler("hello-world", ({ event }) =>
  Effect.gen(function* () {
    const greetingName = Predicate.hasProperty(event, "name") ? event.name : "Guest";
    yield* Effect.log(`hello-world greeting ${greetingName}`);
    return { greeting: `Hello, ${greetingName}!` };
  }).pipe(Effect.withSpan("example/hello-world"), Effect.withLogSpan("example/hello-world")),
);

const ClientLive = InngestClient.layer({
  id: "research-app",
  mode: "dev",
  apiBaseUrl: "http://127.0.0.1:8288",
}).pipe(Layer.provide(FetchHttpClient.layer));

HttpServer.serve(InngestGroup.toHttpApp(Group), HttpMiddleware.logger).pipe(
  HttpServer.withLogAddress,
  Layer.provide(Logger.pretty),
  Layer.provide(BunHttpServer.layer({ port: 9999, hostname: "0.0.0.0" })),
  Layer.provide(HelloFnHandler),
  Layer.provide(ClientLive),
  Layer.provide(FetchHttpClient.layer),
  Layer.launch,
  BunRuntime.runMain,
);
