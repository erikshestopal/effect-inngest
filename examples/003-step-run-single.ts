import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { InngestFunction, InngestGroup } from "effect-inngest";
import { defineExample, eventCase } from "./_support.ts";

class DemoStepSingle extends Schema.TaggedClass<DemoStepSingle>()("demo/step-single", {
  value: Schema.Number,
}) {}

const StepSingleFn = InngestFunction.make("step-single", {
  trigger: { event: DemoStepSingle },
  success: Schema.Struct({ doubled: Schema.Number }),
});

const Group = InngestGroup.make(StepSingleFn);

const HandlersLive = Group.toLayer({
  "step-single": ({ event, step }) =>
    Effect.gen(function* () {
      yield* Effect.log(`step-single input: ${event.value}`);
      const doubled = yield* step.run(
        "double",
        Effect.gen(function* () {
          yield* Effect.log(`doubling ${event.value}`);
          return event.value * 2;
        }),
      );
      yield* Effect.log(`step-single doubled: ${doubled}`);
      return { doubled };
    }).pipe(Effect.withSpan("example/step-single")),
});

export default defineExample({
  id: "003-step-run-single",
  group: Group,
  handlers: HandlersLive,
  cases: [
    eventCase({
      events: [
        {
          name: "demo/step-single",
          data: {
            value: 21,
          },
        },
      ],
      expect: [
        {
          spans: ["double"],
          functionTag: "step-single",
        },
      ],
    }),
  ],
});
