import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { InngestFunction, InngestGroup, InngestEvent, Inngest } from "effect-inngest";
import { defineExample, eventCase } from "./_support.ts";

const DemoParallelMixed = InngestEvent.make("examples/043-parallel-mixed/demo/parallel-mixed", Schema.Struct({}));

const DemoSideEffect = InngestEvent.make(
  "examples/043-parallel-mixed/demo/side-effect",
  Schema.Struct({
    source: Schema.String,
  }),
);

const ParallelMixedFn = InngestFunction.make("parallel-mixed", {
  trigger: { event: DemoParallelMixed },
});

const Group = InngestGroup.make(ParallelMixedFn);

const HandlersLive = Group.toLayer({
  "parallel-mixed": () =>
    Effect.gen(function* () {
      yield* Effect.log("Starting parallel mixed steps...");

      const [computed, _sleptResult, _sentResult] = yield* Effect.all(
        [
          Inngest.run("compute", Effect.succeed(42)),
          Inngest.sleep("short-wait", Duration.seconds(2)),
          Inngest.sendEvent("notify", DemoSideEffect.make({ source: "parallel-mixed-function" })),
        ],
        { concurrency: "unbounded" },
      );

      yield* Effect.log(`Parallel steps complete! Computed: ${computed}`);
      return { computed, slept: true, sent: true };
    }),
});

export default defineExample({
  id: "043-parallel-mixed",
  group: Group,
  handlers: HandlersLive,
  cases: [
    eventCase({
      eventKey: "test",
      events: [
        {
          name: "examples/043-parallel-mixed/demo/parallel-mixed",
          data: {},
        },
      ],
      expect: [
        {
          spans: ["compute", "short-wait", "notify"],
          functionTag: "parallel-mixed",
        },
      ],
      timeoutMs: 20000,
    }),
  ],
});
