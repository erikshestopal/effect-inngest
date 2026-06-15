import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { InngestFunction, InngestGroup, InngestEvent } from "effect-inngest";
import { defineExample, eventCase } from "./_support.ts";

class StepError extends Schema.TaggedErrorClass<StepError>()("StepError", {
  message: Schema.String,
}) {}

const DemoStepCatch = InngestEvent.make("demo/step-catch", Schema.Struct({}));

const StepCatchFn = InngestFunction.make("step-catch-handler", {
  trigger: { event: DemoStepCatch },
  success: Schema.Struct({ result: Schema.String }),
});

const Group = InngestGroup.make(StepCatchFn);

const HandlersLive = Group.toLayer({
  "step-catch-handler": ({ step }) =>
    Effect.gen(function* () {
      const result = yield* step
        .run("risky-step", Effect.fail(new StepError({ message: "Something went wrong" })))
        .pipe(
          Effect.catch((error) =>
            Effect.succeed(`Caught error: ${error instanceof Error ? error.message : "unknown"}`),
          ),
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
          name: "demo/step-catch",
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
