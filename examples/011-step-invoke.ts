import { FetchHttpClient } from "@effect/platform";
import { BunHttpServer, BunRuntime } from "@effect/platform-bun";
import * as HttpMiddleware from "@effect/platform/HttpMiddleware";
import * as HttpServer from "@effect/platform/HttpServer";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Predicate from "effect/Predicate";
import * as Schema from "effect/Schema";
import { InngestClient, InngestFunction, InngestGroup } from "effect-inngest";

class DemoInvokeParent extends Schema.TaggedClass<DemoInvokeParent>()("demo/invoke-parent", {
  number: Schema.Number,
}) {}

class DemoInvokeChild extends Schema.TaggedClass<DemoInvokeChild>()("demo/invoke-child", {
  value: Schema.Number,
}) {}

class DemoInvokeChild2 extends Schema.TaggedClass<DemoInvokeChild2>()("demo/invoke-child-2", {
  test: Schema.String,
}) {}

const ChildFn = InngestFunction.make("child-square", {
  trigger: [{ event: DemoInvokeChild }, { event: DemoInvokeChild2 }],
  success: Schema.Struct({ squared: Schema.Number }),
});

const ParentFn = InngestFunction.make("parent-invoke", {
  trigger: { event: DemoInvokeParent },
  success: Schema.Struct({ result: Schema.Number }),
});

const Group = InngestGroup.make(ChildFn, ParentFn);

const HandlersLive = Group.toLayer({
  "child-square": ({ event }) =>
    Effect.succeed({
      squared: Predicate.hasProperty(event, "value") ? event.value * event.value : event.test.length,
    }),
  "parent-invoke": ({ event, step }) =>
    Effect.gen(function* () {
      const childResult = yield* step.invoke("call-child", {
        function: ChildFn,
        data: DemoInvokeChild.make({ value: event.number }),
      });
      return { result: childResult.squared };
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
