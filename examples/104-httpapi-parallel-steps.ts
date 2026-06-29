import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { InngestFunction, InngestGroup, InngestEvent, Inngest } from "effect-inngest";
import { defineExample, eventCase } from "./_support.ts";

const DemoParallel = InngestEvent.make(
  "examples/104-httpapi-parallel-steps/examples/104/demo/parallel",
  Schema.Struct({
    a: Schema.Number,
    b: Schema.Number,
  }),
);

const ParallelFn = InngestFunction.make("parallel-test", {
  trigger: DemoParallel,
});

const Group = InngestGroup.make(ParallelFn);

const HandlersLive = Group.toLayer({
  "parallel-test": ({ event }) =>
    Effect.gen(function* () {
      const [sum, product] = yield* Effect.all(
        [
          Inngest.run("sum", Effect.succeed(event.data.a + event.data.b)),
          Inngest.run("product", Effect.succeed(event.data.a * event.data.b)),
        ],
        { concurrency: "unbounded" },
      );
      return { sum, product };
    }),
});

export default defineExample({
  id: "104-httpapi-parallel-steps",
  group: Group,
  handlers: HandlersLive,
  cases: [
    eventCase({
      events: [
        {
          name: "examples/104-httpapi-parallel-steps/examples/104/demo/parallel",
          data: {
            a: 6,
            b: 7,
          },
        },
      ],
      expect: [
        {
          spans: ["sum", "product"],
          functionTag: "parallel-test",
        },
      ],
    }),
  ],
});
