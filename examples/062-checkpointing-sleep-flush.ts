import { defineExample, eventCase } from "./_support.ts";
/**
 * Spec §10.4.1 — async opcodes (Sleep, WaitForEvent, Invoke) force a buffer
 * flush before yielding. Here 2 buffered `Inngest.run` results are checkpointed
 * prior to the `Inngest.sleep` opcode, so the executor sees them durably before
 * the sleep schedule.
 */
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { InngestFunction, InngestGroup, InngestEvent, Inngest } from "effect-inngest";

const SleepEvent = InngestEvent.make(
  "examples/062-checkpointing-sleep-flush/demo/checkpoint-sleep",
  Schema.Struct({
    tag: Schema.String,
  }),
);

const Fn = InngestFunction.make("checkpoint-sleep", {
  trigger: { event: SleepEvent }, // bufferedSteps high enough that the sleep-flush is what actually triggers
  // the checkpoint POST.
  checkpointing: { bufferedSteps: 10 },
});

const Group = InngestGroup.make(Fn);

const HandlersLive = Group.toLayer({
  "checkpoint-sleep": ({ event }) =>
    Effect.gen(function* () {
      yield* Inngest.run("prepare-a", Effect.succeed("a"));
      yield* Inngest.run("prepare-b", Effect.succeed("b"));
      yield* Inngest.sleep("nap", "2 seconds");
      return { tag: event.data.tag };
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
          name: "examples/062-checkpointing-sleep-flush/demo/checkpoint-sleep",
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
