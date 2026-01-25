import { FetchHttpClient } from "@effect/platform";
import { BunHttpServer, BunRuntime } from "@effect/platform-bun";
import * as HttpMiddleware from "@effect/platform/HttpMiddleware";
import * as HttpServer from "@effect/platform/HttpServer";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import { InngestClient, InngestFunction, InngestGroup } from "effect-inngest";

class DemoReturnTypes extends Schema.TaggedClass<DemoReturnTypes>()("demo/return-types", {}) {}

const ReturnTypesFn = InngestFunction.make("return-types-demo", {
  trigger: { event: DemoReturnTypes },
  success: Schema.Struct({
    stringResult: Schema.String,
    numberResult: Schema.Number,
    objectResult: Schema.Struct({ key: Schema.String, count: Schema.Number }),
    arrayResult: Schema.Array(Schema.Number),
    boolResult: Schema.Boolean,
  }),
});

const Group = InngestGroup.make(ReturnTypesFn);

const HandlersLive = Group.toLayer({
  "return-types-demo": ({ step }) =>
    Effect.gen(function* () {
      const stringResult: string = yield* step.run("return-string", Effect.succeed("hello"));

      const numberResult: number = yield* step.run("return-number", Effect.succeed(42));

      const objectResult: { key: string; count: number } = yield* step.run(
        "return-object",
        Effect.succeed({ key: "test", count: 100 }),
      );

      const arrayResult: number[] = yield* step.run("return-array", Effect.succeed([1, 2, 3, 4, 5]));

      const boolResult: boolean = yield* step.run("return-boolean", Effect.succeed(true));

      const combined = yield* step.run(
        "use-all-types",
        Effect.succeed(`${stringResult}-${numberResult}-${objectResult.key}-${arrayResult.length}-${boolResult}`),
      );

      yield* Effect.log(`Combined: ${combined}`);

      return {
        stringResult,
        numberResult,
        objectResult,
        arrayResult,
        boolResult,
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
