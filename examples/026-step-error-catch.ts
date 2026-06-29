import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { InngestFunction, InngestGroup, InngestEvent, Inngest } from "effect-inngest";
import { defineExample, eventCase } from "./_support.ts";

class StepError extends Schema.TaggedErrorClass<StepError>()("StepError", {
  message: Schema.String,
}) {}

const DemoStepCatch = InngestEvent.make("examples/026-step-error-catch/demo/step-catch", Schema.Struct({}));

const StepCatchFn = InngestFunction.make("step-catch-handler", {
  trigger: DemoStepCatch,
});

const Group = InngestGroup.make(StepCatchFn);

const HandlersLive = Group.toLayer({
  "step-catch-handler": () =>
    Effect.gen(function* () {
      const result = yield* Inngest.run(
        "risky-step",
        Effect.fail(new StepError({ message: "Something went wrong" })),
      ).pipe(
        Effect.catch((error) => Effect.succeed(`Caught error: ${error instanceof Error ? error.message : "unknown"}`)),
      );
      return { result };
    }),
});

export default defineExample({
  id: "026-step-error-catch",
  group: Group,
  handlers: HandlersLive,
  cases: [
    eventCase({
      events: [
        {
          name: "examples/026-step-error-catch/demo/step-catch",
          data: {},
        },
      ],
      expect: [
        {
          functionTag: "step-catch-handler",
        },
      ],
    }),
  ],
});
