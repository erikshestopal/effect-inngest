import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { InngestFunction, InngestGroup, InngestEvent, Inngest } from "effect-inngest";
import { defineExample, eventCase } from "./_support.ts";

const DemoConditional = InngestEvent.make(
  "examples/038-conditional-steps/demo/conditional",
  Schema.Struct({
    shouldSkip: Schema.Boolean,
  }),
);

const ConditionalFn = InngestFunction.make("conditional-steps", {
  trigger: { event: DemoConditional },
});

const Group = InngestGroup.make(ConditionalFn);

const HandlersLive = Group.toLayer({
  "conditional-steps": ({ event }) =>
    Effect.gen(function* () {
      yield* Inngest.run("setup", Effect.succeed("initialized"));

      if (event.data.shouldSkip) {
        const quickResult = yield* Inngest.run("quick-path", Effect.succeed("skipped heavy work"));
        return { path: "quick", result: quickResult };
      } else {
        const step1 = yield* Inngest.run("heavy-step-1", Effect.succeed("processed-1"));
        const step2 = yield* Inngest.run("heavy-step-2", Effect.succeed("processed-2"));
        const step3 = yield* Inngest.run("heavy-step-3", Effect.succeed("processed-3"));
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
          name: "examples/038-conditional-steps/demo/conditional",
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
