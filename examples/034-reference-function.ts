import { FetchHttpClient } from "@effect/platform";
import { BunHttpServer, BunRuntime } from "@effect/platform-bun";
import * as HttpMiddleware from "@effect/platform/HttpMiddleware";
import * as HttpServer from "@effect/platform/HttpServer";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import { InngestClient, InngestFunction, InngestGroup } from "effect-inngest";

class DemoReferenceInvoke extends Schema.TaggedClass<DemoReferenceInvoke>()("demo/reference-invoke", {}) {}

class DemoHelperEvent extends Schema.TaggedClass<DemoHelperEvent>()("demo/helper-event", {
  input: Schema.Number,
}) {}

const HelperFn = InngestFunction.make("helper-function", {
  trigger: { event: DemoHelperEvent },
  success: Schema.Struct({ doubled: Schema.Number }),
});

const InvokerFn = InngestFunction.make("invoke-by-reference", {
  trigger: { event: DemoReferenceInvoke },
  success: Schema.Struct({ result: Schema.Number }),
});

const Group = InngestGroup.make(HelperFn, InvokerFn);

const HandlersLive = Group.toLayer({
  "helper-function": ({ event }) => Effect.succeed({ doubled: event.input * 2 }),
  "invoke-by-reference": ({ step }) =>
    Effect.gen(function* () {
      const helperResult = yield* step.invoke("call-helper", {
        function: HelperFn,
        data: { input: 21 } as never,
      });
      return { result: helperResult.doubled };
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
