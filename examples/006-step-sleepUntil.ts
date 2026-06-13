import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { InngestFunction, InngestGroup } from "effect-inngest";
import { defineExample, eventCase } from "./_support.ts";

class DemoSleepUntil extends Schema.TaggedClass<DemoSleepUntil>()("demo/sleep-until", {}) {}

const SleepUntilFn = InngestFunction.make("sleep-until", {
  trigger: { event: DemoSleepUntil },
  success: Schema.Struct({ wokeAt: Schema.String }),
});

const Group = InngestGroup.make(SleepUntilFn);

const HandlersLive = Group.toLayer({
  "sleep-until": ({ step }) =>
    Effect.gen(function* () {
      const target = new Date(Date.now() + 5000);
      yield* step.sleepUntil("wait-until", target);
      return { wokeAt: new Date().toISOString() };
    }),
});

export default defineExample({
  id: "006-step-sleepUntil",
  group: Group,
  handlers: HandlersLive,
  cases: [
    eventCase({
      events: [
        {
          name: "demo/sleep-until",
          data: {},
        },
      ],
      expect: [
        {
          spans: ["wait-until"],
          functionTag: "sleep-until",
        },
      ],
      timeoutMs: 20000,
    }),
  ],
});
