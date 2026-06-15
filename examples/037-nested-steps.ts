import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { InngestFunction, InngestGroup, InngestEvent } from "effect-inngest";
import { defineExample, eventCase } from "./_support.ts";

const DemoNested = InngestEvent.make("demo/nested", Schema.Struct({}));

const NestedStepsFn = InngestFunction.make("nested-steps-demo", {
  trigger: { event: DemoNested },
  success: Schema.Struct({
    level1: Schema.Number,
    level2: Schema.Number,
    level3: Schema.Number,
    final: Schema.Number,
  }),
});

const Group = InngestGroup.make(NestedStepsFn);

const HandlersLive = Group.toLayer({
  "nested-steps-demo": ({ step }) =>
    Effect.gen(function* () {
      const level1 = yield* step.run("level-1", Effect.succeed(10));

      const level2 = yield* step.run("level-2", Effect.succeed(level1 * 2));

      const level3 = yield* step.run("level-3", Effect.succeed(level2 + 5));

      const final = yield* step.run("final-computation", Effect.succeed(level1 + level2 + level3));

      return { level1, level2, level3, final };
    }),
});

export default defineExample({
  id: "037-nested-steps",
  group: Group,
  handlers: HandlersLive,
  cases: [
    eventCase({
      events: [
        {
          name: "demo/nested",
          data: {},
        },
      ],
      expect: [
        {
          spans: ["level-1", "level-2", "level-3", "final-computation"],
          functionTag: "nested-steps-demo",
        },
      ],
    }),
  ],
});
