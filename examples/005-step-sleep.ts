import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { InngestFunction, InngestGroup } from "effect-inngest";
import { defineExample, eventCase } from "./_support.ts";

class DemoSleep extends Schema.TaggedClass<DemoSleep>()("demo/sleep", {}) {}

const SleepFn = InngestFunction.make("sleep-test", {
  trigger: { event: DemoSleep },
  success: Schema.Struct({ slept: Schema.Boolean }),
});

const Group = InngestGroup.make(SleepFn);

const HandlersLive = Group.toLayer({
  "sleep-test": ({ step }) =>
    Effect.gen(function* () {
      yield* Effect.log("sleep-test starting");
      yield* step.sleep("wait", "1 second");
      yield* Effect.log("sleep-test completed");
      return { slept: true };
    }).pipe(Effect.withSpan("example/sleep-test")),
});

export default defineExample({
  id: "005-step-sleep",
  group: Group,
  handlers: HandlersLive,
  cases: [
    eventCase({
      events: [
        {
          name: "demo/sleep",
          data: {},
        },
      ],
      expect: [
        {
          spans: ["wait"],
          functionTag: "sleep-test",
        },
      ],
      timeoutMs: 20000,
    }),
  ],
});
