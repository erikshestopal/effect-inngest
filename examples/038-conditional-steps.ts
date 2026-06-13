import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { InngestFunction, InngestGroup } from "effect-inngest";
import { defineExample, eventCase } from "./_support.ts";

class DemoConditional extends Schema.TaggedClass<DemoConditional>()("demo/conditional", {
  shouldSkip: Schema.Boolean,
}) {}

const ConditionalFn = InngestFunction.make("conditional-steps", {
  trigger: { event: DemoConditional },
  success: Schema.Struct({
    path: Schema.String,
    result: Schema.String,
  }),
});

const Group = InngestGroup.make(ConditionalFn);

const HandlersLive = Group.toLayer({
  "conditional-steps": ({ event, step }) =>
    Effect.gen(function* () {
      yield* step.run("setup", Effect.succeed("initialized"));

      if (event.shouldSkip) {
        const quickResult = yield* step.run("quick-path", Effect.succeed("skipped heavy work"));
        return { path: "quick", result: quickResult };
      } else {
        const step1 = yield* step.run("heavy-step-1", Effect.succeed("processed-1"));
        const step2 = yield* step.run("heavy-step-2", Effect.succeed("processed-2"));
        const step3 = yield* step.run("heavy-step-3", Effect.succeed("processed-3"));
        return { path: "full", result: `${step1},${step2},${step3}` };
      }
    }),
});

export default defineExample({
  id: "038-conditional-steps",
  group: Group,
  handlers: HandlersLive,
  cases: [
    eventCase({
      events: [
        {
          name: "demo/conditional",
          data: {
            shouldSkip: false,
          },
        },
      ],
      expect: [
        {
          spans: ["setup", "heavy-step-1", "heavy-step-2", "heavy-step-3"],
          functionTag: "conditional-steps",
        },
      ],
    }),
  ],
});
