import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { InngestFunction, InngestGroup, InngestEvent } from "effect-inngest";
import { defineExample, eventCase } from "./_support.ts";

const DemoStepSingle = InngestEvent.make(
  "examples/102-httpapi-step-run/demo/step-single",
  Schema.Struct({
    value: Schema.Number,
  }),
);

const StepSingleFn = InngestFunction.make("step-single", {
  trigger: { event: DemoStepSingle },
  success: Schema.Struct({ doubled: Schema.Number }),
});

const Group = InngestGroup.make(StepSingleFn);

const HandlersLive = Group.toLayer({
  "step-single": ({ event, step }) =>
    Effect.gen(function* () {
      const doubled = yield* step.run("double", Effect.succeed(event.data.value * 2), { schema: Schema.Number });
      return { doubled };
    }),
});

export default defineExample({
  id: "102-httpapi-step-run",
  group: Group,
  handlers: HandlersLive,
  cases: [
    eventCase({
      events: [
        {
          name: "examples/102-httpapi-step-run/demo/step-single",
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
