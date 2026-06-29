import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { InngestFunction, InngestGroup, InngestEvent, Inngest } from "effect-inngest";
import { defineExample, eventCase } from "./_support.ts";

const DemoStepOptions = InngestEvent.make("examples/036-step-run-with-options/demo/step-options", Schema.Struct({}));

const StepOptionsFn = InngestFunction.make("step-options-demo", {
  trigger: { event: DemoStepOptions },
});

const Group = InngestGroup.make(StepOptionsFn);

const HandlersLive = Group.toLayer({
  "step-options-demo": () =>
    Effect.gen(function* () {
      const result1 = yield* Inngest.run("basic-step", Effect.succeed("basic"));

      const result2 = yield* Inngest.run({ id: "named-step", name: "Named Step" }, Effect.succeed("with-name"));

      const result3 = yield* Inngest.run("third-step", Effect.succeed("completed"));

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
          name: "examples/036-step-run-with-options/demo/step-options",
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
