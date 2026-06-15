import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { InngestFunction, InngestGroup, InngestEvent } from "effect-inngest";
import { defineExample, eventCase } from "./_support.ts";

const DemoStepChain = InngestEvent.make(
  "demo/step-chain",
  Schema.Struct({
    value: Schema.Number,
  }),
);

const StepChainFn = InngestFunction.make("step-chain", {
  trigger: { event: DemoStepChain },
  success: Schema.Struct({ result: Schema.Number }),
});

const Group = InngestGroup.make(StepChainFn);

const HandlersLive = Group.toLayer({
  "step-chain": ({ event, step }) =>
    Effect.gen(function* () {
      yield* Effect.log(`step-chain input: ${event.data.value}`);
      const doubled = yield* step.run(
        "double",
        Effect.gen(function* () {
          yield* Effect.log(`doubling ${event.data.value}`);
          return event.data.value * 2;
        }),
      );
      const result = yield* step.run(
        "add-ten",
        Effect.gen(function* () {
          yield* Effect.log(`adding 10 to ${doubled}`);
          return doubled + 10;
        }),
      );
      yield* Effect.log(`step-chain result: ${result}`);
      return { result };
    }).pipe(Effect.withSpan("example/step-chain")),
});

export default defineExample({
  id: "004-step-run-multiple",
  group: Group,
  handlers: HandlersLive,
  cases: [
    eventCase({
      events: [
        {
          name: "demo/step-chain",
          data: {
            value: 16,
          },
        },
      ],
      expect: [
        {
          spans: ["double", "add-ten"],
          functionTag: "step-chain",
        },
      ],
    }),
  ],
});
