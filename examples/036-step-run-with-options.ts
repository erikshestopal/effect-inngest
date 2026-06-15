import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { InngestFunction, InngestGroup, InngestEvent } from "effect-inngest";
import { defineExample, eventCase } from "./_support.ts";

const DemoStepOptions = InngestEvent.make("demo/step-options", Schema.Struct({}));

const StepOptionsFn = InngestFunction.make("step-options-demo", {
  trigger: { event: DemoStepOptions },
  success: Schema.Struct({ results: Schema.Array(Schema.String) }),
});

const Group = InngestGroup.make(StepOptionsFn);

const HandlersLive = Group.toLayer({
  "step-options-demo": ({ step }) =>
    Effect.gen(function* () {
      const result1 = yield* step.run("basic-step", Effect.succeed("basic"));

      const result2 = yield* step.run({ id: "named-step", name: "Named Step" }, Effect.succeed("with-name"));

      const result3 = yield* step.run("third-step", Effect.succeed("completed"));

      return { results: [result1, result2, result3] };
    }),
});

export default defineExample({
  id: "036-step-run-with-options",
  group: Group,
  handlers: HandlersLive,
  cases: [
    eventCase({
      events: [
        {
          name: "demo/step-options",
          data: {},
        },
      ],
      expect: [
        {
          spans: ["basic-step", "Named Step", "third-step"],
          functionTag: "step-options-demo",
        },
      ],
    }),
  ],
});
