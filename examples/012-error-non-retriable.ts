import { FetchHttpClient } from "effect/unstable/http";
import { BunHttpServer, BunRuntime } from "@effect/platform-bun";
import * as HttpMiddleware from "effect/unstable/http/HttpMiddleware";
import * as HttpServer from "effect/unstable/http/HttpServer";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import { InngestClient, InngestFunction, InngestGroup } from "effect-inngest";
import { NonRetriableError } from "effect-inngest";

class DemoNonRetriable extends Schema.TaggedClass<DemoNonRetriable>()("demo/non-retriable", {}) {}

const NonRetriableFn = InngestFunction.make("non-retriable", {
  trigger: { event: DemoNonRetriable },
  success: Schema.Struct({ success: Schema.Boolean }),
});

const Group = InngestGroup.make(NonRetriableFn);

const HandlersLive = Group.toLayer({
  "non-retriable": ({ step }) => step.run("fail", Effect.fail(new NonRetriableError({ message: "No retry" }))),
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
