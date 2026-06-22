import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { InngestFunction, InngestGroup, InngestEvent } from "effect-inngest";
import { defineExample, eventCase } from "./_support.ts";

const DemoMemoized = InngestEvent.make("examples/027-step-memoization/demo/memoized", Schema.Struct({}));

const MemoizedFn = InngestFunction.make("memoization-demo", {
  trigger: { event: DemoMemoized },
  success: Schema.Struct({
    timestamp: Schema.Number,
    randomValue: Schema.Number,
  }),
});

const Group = InngestGroup.make(MemoizedFn);

const HandlersLive = Group.toLayer({
  "memoization-demo": ({ step }) =>
    Effect.gen(function* () {
      const timestamp = yield* step.run("capture-time", Effect.succeed(Date.now()), { schema: Schema.Number });
      const randomValue = yield* step.run("capture-random", Effect.succeed(Math.random()), { schema: Schema.Number });

      yield* step.sleep("checkpoint", Duration.seconds(1));

      yield* step.run(
        "verify",
        Effect.sync(() => console.log(`Timestamp: ${timestamp}, Random: ${randomValue}`)),
      );

      return { timestamp, randomValue };
    }),
});

export default defineExample({
  id: "027-step-memoization",
  group: Group,
  handlers: HandlersLive,
  cases: [
    eventCase({
      events: [
        {
          name: "examples/027-step-memoization/demo/memoized",
          data: {},
        },
      ],
      expect: [
        {
          spans: ["capture-time", "capture-random", "checkpoint", "verify"],
          functionTag: "memoization-demo",
        },
      ],
      timeoutMs: 20000,
    }),
  ],
});
