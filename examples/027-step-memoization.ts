import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { InngestFunction, InngestGroup, InngestEvent, Inngest } from "effect-inngest";
import { defineExample, eventCase } from "./_support.ts";

const DemoMemoized = InngestEvent.make("examples/027-step-memoization/demo/memoized", Schema.Struct({}));

const MemoizedFn = InngestFunction.make("memoization-demo", {
  trigger: DemoMemoized,
});

const Group = InngestGroup.make(MemoizedFn);

const HandlersLive = Group.toLayer({
  "memoization-demo": () =>
    Effect.gen(function* () {
      const timestamp = yield* Inngest.run("capture-time", Effect.succeed(Date.now()));
      const randomValue = yield* Inngest.run("capture-random", Effect.succeed(Math.random()));

      yield* Inngest.sleep("checkpoint", Duration.seconds(1));

      yield* Inngest.run(
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
