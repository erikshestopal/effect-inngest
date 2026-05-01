import { FetchHttpClient } from "effect/unstable/http";
import { BunHttpServer, BunRuntime } from "@effect/platform-bun";
import * as HttpMiddleware from "effect/unstable/http/HttpMiddleware";
import * as HttpServer from "effect/unstable/http/HttpServer";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { Predicate } from "effect";
import * as Schema from "effect/Schema";
import { InngestClient, InngestFunction, InngestGroup } from "effect-inngest";
import { NonRetriableError } from "effect-inngest";

class DemoInvokeFailing extends Schema.TaggedClass<DemoInvokeFailing>()("demo/invoke-failing", {}) {}

class DemoFailingChild extends Schema.TaggedClass<DemoFailingChild>()("demo/failing-child", {}) {}

const FailingChildFn = InngestFunction.make("failing-child", {
  trigger: { event: DemoFailingChild },
  success: Schema.Struct({ never: Schema.String }),
});

const ParentFn = InngestFunction.make("parent-invoker", {
  trigger: { event: DemoInvokeFailing },
  success: Schema.Struct({ status: Schema.String, error: Schema.optional(Schema.String) }),
});

const Group = InngestGroup.make(FailingChildFn, ParentFn);

const HandlersLive = Group.toLayer({
  "failing-child": () => Effect.fail(new NonRetriableError({ message: "Child always fails" })),

  "parent-invoker": ({ step }) =>
    Effect.gen(function* () {
      const result = yield* step.invoke("call-child", { function: FailingChildFn, data: {} as never }).pipe(
        Effect.map(() => ({ status: "success" as const })),
        Effect.catch((error) =>
          Effect.succeed({
            status: "caught-error" as const,
            error:
              typeof error === "object" && error !== null && Predicate.hasProperty(error, "message")
                ? String(error.message)
                : "unknown",
          }),
        ),
      );
      return result;
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
