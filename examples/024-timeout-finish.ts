import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { InngestFunction, InngestGroup, InngestEvent } from "effect-inngest";
import { defineExample, eventCase } from "./_support.ts";

const DemoLongRunning = InngestEvent.make("examples/024-timeout-finish/demo/long-running", Schema.Struct({}));

const LongRunningFn = InngestFunction.make("long-running-task", {
  trigger: { event: DemoLongRunning },
  timeouts: { finish: "2 seconds" },
  success: Schema.Struct({ status: Schema.String }),
});

const Group = InngestGroup.make(LongRunningFn);

const HandlersLive = Group.toLayer({
  "long-running-task": ({ step }) =>
    Effect.gen(function* () {
      yield* step.run("work-1", Effect.succeed("Phase 1 done"), { schema: Schema.String });
      yield* step.sleep("long-wait", Duration.seconds(5));
      yield* step.run("work-2", Effect.succeed("Phase 2 done"), { schema: Schema.String });
      return { status: "completed" };
    }),
});

export default defineExample({
  id: "024-timeout-finish",
  group: Group,
  handlers: HandlersLive,
  cases: [
    eventCase({
      events: [
        {
          name: "examples/024-timeout-finish/demo/long-running",
          data: {},
        },
      ],
      expect: [
        {
          status: ["CANCELLED", "CANCELED", "COMPLETED", "FAILED", "TIMED_OUT"],
          spans: ["work-1", "long-wait"],
          functionTag: "long-running-task",
        },
      ],
      timeoutMs: 20000,
    }),
  ],
});
