import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { InngestFunction, InngestGroup, InngestEvent, Inngest } from "effect-inngest";
import { defineExample, eventCase } from "./_support.ts";

const DemoSlowStart = InngestEvent.make("examples/033-timeout-start/demo/slow-start", Schema.Struct({}));

const SlowStartFn = InngestFunction.make("slow-start-task", {
  trigger: DemoSlowStart,
  timeouts: { start: "10 seconds" },
});

const Group = InngestGroup.make(SlowStartFn);

const HandlersLive = Group.toLayer({
  "slow-start-task": () =>
    Effect.gen(function* () {
      yield* Inngest.run("quick-work", Effect.succeed("Started successfully"));
      return { status: "completed" };
    }),
});

export default defineExample({
  id: "033-timeout-start",
  group: Group,
  handlers: HandlersLive,
  cases: [
    eventCase({
      events: [
        {
          name: "examples/033-timeout-start/demo/slow-start",
          data: {},
        },
      ],
      expect: [
        {
          spans: ["quick-work"],
          functionTag: "slow-start-task",
        },
      ],
    }),
  ],
});
