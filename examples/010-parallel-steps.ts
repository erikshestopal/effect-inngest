import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { InngestFunction, InngestGroup } from "effect-inngest";
import { defineExample, eventCase } from "./_support.ts";

class DemoParallel extends Schema.TaggedClass<DemoParallel>()("demo/parallel", {}) {}

const ParallelFn = InngestFunction.make("parallel-steps", {
  trigger: { event: DemoParallel },
  success: Schema.Struct({ results: Schema.Array(Schema.Number) }),
});

const Group = InngestGroup.make(ParallelFn);

const HandlersLive = Group.toLayer({
  "parallel-steps": ({ step }) =>
    Effect.gen(function* () {
      const results = yield* Effect.all(
        [
          step.run("step-1", Effect.succeed(1)),
          step.run("step-2", Effect.succeed(2)),
          step.run("step-3", Effect.succeed(3)),
        ],
        { concurrency: "unbounded" },
      );
      return { results };
    }),
});

export default defineExample({
  id: "010-parallel-steps",
  group: Group,
  handlers: HandlersLive,
  cases: [
    eventCase({
      events: [
        {
          name: "demo/parallel",
          data: {},
        },
      ],
      expect: [
        {
          spans: ["step-1", "step-2", "step-3"],
          functionTag: "parallel-steps",
        },
      ],
    }),
  ],
});
