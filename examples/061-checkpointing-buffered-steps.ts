import { defineExample, eventCase } from "./_support.ts";
/**
 * Spec §10.1.2 — `bufferedSteps: 2` batches 2 steps per checkpoint POST.
 *
 * Four sequential `step.run` calls. Steps 1+2 are flushed together, 3+4 are
 * flushed together. The final 206 ends with `RunComplete` (no buffered
 * remainder). Verify the dev-server timeline shows 2 checkpoint batches.
 */
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { InngestFunction, InngestGroup, InngestEvent } from "effect-inngest";

const BufferedEvent = InngestEvent.make(
  "demo/checkpoint-buffered",
  Schema.Struct({
    base: Schema.Number,
  }),
);

const Fn = InngestFunction.make("checkpoint-buffered", {
  trigger: { event: BufferedEvent },
  success: Schema.Struct({ total: Schema.Number }),
  checkpointing: { bufferedSteps: 2 },
});

const Group = InngestGroup.make(Fn);

const HandlersLive = Group.toLayer({
  "checkpoint-buffered": ({ event, step }) =>
    Effect.gen(function* () {
      const a = yield* step.run("a", Effect.succeed(event.data.base + 1));
      const b = yield* step.run("b", Effect.succeed(event.data.base + 2));
      const c = yield* step.run("c", Effect.succeed(event.data.base + 3));
      const d = yield* step.run("d", Effect.succeed(event.data.base + 4));
      return { total: a + b + c + d };
    }),
});

export default defineExample({
  id: "061-checkpointing-buffered-steps",
  group: Group,
  handlers: HandlersLive,
  cases: [
    eventCase({
      eventKey: "test",
      events: [
        {
          name: "demo/checkpoint-buffered",
          data: {
            base: 10,
          },
        },
      ],
      expect: [
        {
          spans: ["a", "b", "c", "d"],
          functionTag: "checkpoint-buffered",
        },
      ],
    }),
  ],
});
