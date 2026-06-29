import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { InngestFunction, InngestGroup, InngestEvent, Inngest } from "effect-inngest";
import { defineExample, eventCase } from "./_support.ts";

const DemoReturnTypes = InngestEvent.make("examples/040-step-return-types/demo/return-types", Schema.Struct({}));

const ReturnTypesFn = InngestFunction.make("return-types-demo", {
  trigger: DemoReturnTypes,
});

const Group = InngestGroup.make(ReturnTypesFn);

const HandlersLive = Group.toLayer({
  "return-types-demo": () =>
    Effect.gen(function* () {
      const stringResult: string = yield* Inngest.run("return-string", Effect.succeed("hello"));

      const numberResult: number = yield* Inngest.run("return-number", Effect.succeed(42));

      const objectResult: { key: string; count: number } = yield* Inngest.run(
        "return-object",
        Effect.succeed({ key: "test", count: 100 }),
      );

      const arrayResult: ReadonlyArray<number> = yield* Inngest.run("return-array", Effect.succeed([1, 2, 3, 4, 5]));

      const boolResult: boolean = yield* Inngest.run("return-boolean", Effect.succeed(true));

      const combined = yield* Inngest.run(
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
