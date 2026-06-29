import { defineExample, eventCase } from "./_support.ts";
/**
 * Spec §10.1.1 — function-level checkpointing overrides the client default.
 *
 * Client sets `bufferedSteps: 5`; this function overrides to `bufferedSteps: 1`,
 * so every step is flushed immediately. Verify registration sends a per-function
 * `checkpoint.batch_steps: 1`, and the dev-server timeline shows one checkpoint
 * per step rather than one per batch.
 */
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { InngestFunction, InngestGroup, InngestEvent } from "effect-inngest";

const OverrideEvent = InngestEvent.make(
  "examples/064-checkpointing-fn-override/demo/checkpoint-override",
  Schema.Struct({
    key: Schema.String,
  }),
);

const Fn = InngestFunction.make("checkpoint-override", {
  trigger: { event: OverrideEvent }, // Overrides client-level `bufferedSteps: 5` → flush-per-step.
  checkpointing: { bufferedSteps: 1 },
});

const Group = InngestGroup.make(Fn);

const HandlersLive = Group.toLayer({
  "checkpoint-override": ({ event, step }) =>
    Effect.gen(function* () {
      yield* step.run("a", Effect.succeed("A"));
      yield* step.run("b", Effect.succeed("B"));
      yield* step.run("c", Effect.succeed("C"));
      return { key: event.data.key };
    }),
});

export default defineExample({
  id: "064-checkpointing-fn-override",
  group: Group,
  handlers: HandlersLive,
  cases: [
    eventCase({
      eventKey: "test",
      events: [
        {
          name: "examples/064-checkpointing-fn-override/demo/checkpoint-override",
          data: {
            key: "override-064",
          },
        },
      ],
      expect: [
        {
          spans: ["a", "b", "c"],
          functionTag: "checkpoint-override",
        },
      ],
    }),
  ],
});
