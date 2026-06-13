import { defineExample, eventCase } from "./_support.ts";
/**
 * Spec §10.4.1 — async opcodes (Sleep, WaitForEvent, Invoke) force a buffer
 * flush before yielding. Here 2 buffered `step.run` results are checkpointed
 * prior to the `step.sleep` opcode, so the executor sees them durably before
 * the sleep schedule.
 */
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { InngestFunction, InngestGroup } from "effect-inngest";

class SleepEvent extends Schema.TaggedClass<SleepEvent>()("demo/checkpoint-sleep", {
  tag: Schema.String,
}) {}

const Fn = InngestFunction.make("checkpoint-sleep", {
  trigger: { event: SleepEvent },
  success: Schema.Struct({ tag: Schema.String }),
  // bufferedSteps high enough that the sleep-flush is what actually triggers
  // the checkpoint POST.
  checkpointing: { bufferedSteps: 10 },
});

const Group = InngestGroup.make(Fn);

const HandlersLive = Group.toLayer({
  "checkpoint-sleep": ({ event, step }) =>
    Effect.gen(function* () {
      yield* step.run("prepare-a", Effect.succeed("a"));
      yield* step.run("prepare-b", Effect.succeed("b"));
      yield* step.sleep("nap", "2 seconds");
      return { tag: event.tag };
    }),
});

export default defineExample({
  id: "062-checkpointing-sleep-flush",
  group: Group,
  handlers: HandlersLive,
  cases: [
    eventCase({
      eventKey: "test",
      events: [
        {
          name: "demo/checkpoint-sleep",
          data: {
            tag: "sleep-062",
          },
        },
      ],
      expect: [
        {
          spans: ["prepare-a", "prepare-b", "nap"],
          functionTag: "checkpoint-sleep",
        },
      ],
      timeoutMs: 30000,
    }),
  ],
});
