import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { InngestFunction, InngestGroup, InngestEvent, Inngest } from "effect-inngest";
import { defineExample, eventCase } from "./_support.ts";

const DemoSleep = InngestEvent.make("examples/103-httpapi-step-sleep/demo/sleep", Schema.Struct({}));

const SleepFn = InngestFunction.make("sleep-test", {
  trigger: { event: DemoSleep },
});

const Group = InngestGroup.make(SleepFn);

const HandlersLive = Group.toLayer({
  "sleep-test": () =>
    Effect.gen(function* () {
      yield* Inngest.sleep("wait", Duration.seconds(1));
      return { slept: true };
    }),
});

export default defineExample({
  id: "103-httpapi-step-sleep",
  group: Group,
  handlers: HandlersLive,
  cases: [
    eventCase({
      events: [
        {
          name: "examples/103-httpapi-step-sleep/demo/sleep",
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
