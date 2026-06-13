import { defineExample, eventCase } from "./_support.ts";
/**
 * Spec §10.4.1 #7 — `maxRuntime` deadline.
 *
 * Five `step.run` calls each taking ~200ms. With `maxRuntime: 500ms`, the
 * driver interrupts the handler after ~2-3 steps and emits `DiscoveryRequest`
 * so the executor re-invokes the function with the buffered results committed.
 * Verify in dev-server timeline that 5 step runs eventually complete across
 * multiple function call attempts.
 */
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { InngestFunction, InngestGroup } from "effect-inngest";

class DeadlineEvent extends Schema.TaggedClass<DeadlineEvent>()("demo/checkpoint-deadline", {
  runId: Schema.String,
}) {}

const Fn = InngestFunction.make("checkpoint-deadline", {
  trigger: { event: DeadlineEvent },
  success: Schema.Struct({ count: Schema.Number }),
  checkpointing: { bufferedSteps: 1, maxRuntime: "500 millis" },
});

const Group = InngestGroup.make(Fn);

const HandlersLive = Group.toLayer({
  "checkpoint-deadline": ({ step }) =>
    Effect.gen(function* () {
      const slow = (label: string) => Effect.as(Effect.sleep("200 millis"), label);
      yield* step.run("s1", slow("s1"));
      yield* step.run("s2", slow("s2"));
      yield* step.run("s3", slow("s3"));
      yield* step.run("s4", slow("s4"));
      yield* step.run("s5", slow("s5"));
      return { count: 5 };
    }),
});

export default defineExample({
  id: "063-checkpointing-max-runtime",
  group: Group,
  handlers: HandlersLive,
  cases: [
    eventCase({
      eventKey: "test",
      events: [
        {
          name: "demo/checkpoint-deadline",
          data: {
            runId: "deadline-063",
          },
        },
      ],
      expect: [
        {
          spans: ["s1", "s2", "s3", "s4", "s5"],
          functionTag: "checkpoint-deadline",
        },
      ],
      timeoutMs: 40000,
    }),
  ],
});
