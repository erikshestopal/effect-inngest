import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { InngestFunction, InngestGroup, InngestEvent } from "effect-inngest";
import { defineExample, eventCase } from "./_support.ts";

const DemoReturnTypes = InngestEvent.make("examples/040-step-return-types/demo/return-types", Schema.Struct({}));

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
      const stringResult: string = yield* step.run("return-string", Effect.succeed("hello"), { schema: Schema.String });

      const numberResult: number = yield* step.run("return-number", Effect.succeed(42), { schema: Schema.Number });

      const objectResult: { key: string; count: number } = yield* step.run(
        "return-object",
        Effect.succeed({ key: "test", count: 100 }),
        { schema: Schema.Struct({ key: Schema.String, count: Schema.Number }) },
      );

      const arrayResult: ReadonlyArray<number> = yield* step.run("return-array", Effect.succeed([1, 2, 3, 4, 5]), {
        schema: Schema.Array(Schema.Number),
      });

      const boolResult: boolean = yield* step.run("return-boolean", Effect.succeed(true), { schema: Schema.Boolean });

      const combined = yield* step.run(
        "use-all-types",
        Effect.succeed(`${stringResult}-${numberResult}-${objectResult.key}-${arrayResult.length}-${boolResult}`),
        { schema: Schema.String },
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

export default defineExample({
  id: "040-step-return-types",
  group: Group,
  handlers: HandlersLive,
  cases: [
    eventCase({
      events: [
        {
          name: "examples/040-step-return-types/demo/return-types",
          data: {},
        },
      ],
      expect: [
        {
          spans: ["return-string", "return-number", "return-object", "return-array", "return-boolean", "use-all-types"],
          functionTag: "return-types-demo",
        },
      ],
    }),
  ],
});
