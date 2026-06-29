import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { InngestFunction, InngestGroup, InngestEvent, Inngest } from "effect-inngest";
import { defineExample, eventCase } from "./_support.ts";

const DemoParallel = InngestEvent.make("examples/010-parallel-steps/demo/parallel", Schema.Struct({}));

const ParallelFn = InngestFunction.make("parallel-steps", {
  trigger: { event: DemoParallel },
});

const Group = InngestGroup.make(ParallelFn);

const HandlersLive = Group.toLayer({
  "parallel-steps": () =>
    Effect.gen(function* () {
      const results = yield* Effect.all(
        [
          Inngest.run("step-1", Effect.succeed(1)),
          Inngest.run("step-2", Effect.succeed(2)),
          Inngest.run("step-3", Effect.succeed(3)),
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
          name: "examples/010-parallel-steps/demo/parallel",
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
