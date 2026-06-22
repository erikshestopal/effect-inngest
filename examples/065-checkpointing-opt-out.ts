import { defineExample, eventCase } from "./_support.ts";
/**
 * Spec §10.1.1 — function-level opt-out with `checkpointing: false`.
 *
 * Even though the client has checkpointing enabled (default-on), this
 * function opts out. Verify in the dev-server timeline that each step is a
 * classic 206-per-step round trip, no `/v1/checkpoint/{runId}/async` POSTs,
 * and the registration payload omits the `checkpoint` block for this function.
 */
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { InngestFunction, InngestGroup, InngestEvent } from "effect-inngest";

const OptOutEvent = InngestEvent.make(
  "examples/065-checkpointing-opt-out/demo/checkpoint-opt-out",
  Schema.Struct({
    tag: Schema.String,
  }),
);

const Fn = InngestFunction.make("checkpoint-opt-out", {
  trigger: { event: OptOutEvent },
  success: Schema.Struct({ tag: Schema.String }),
  checkpointing: false,
});

const Group = InngestGroup.make(Fn);

const HandlersLive = Group.toLayer({
  "checkpoint-opt-out": ({ event, step }) =>
    Effect.gen(function* () {
      yield* step.run("a", Effect.succeed("A"), { schema: Schema.String });
      yield* step.run("b", Effect.succeed("B"), { schema: Schema.String });
      return { tag: event.data.tag };
    }),
});

export default defineExample({
  id: "065-checkpointing-opt-out",
  group: Group,
  handlers: HandlersLive,
  cases: [
    eventCase({
      eventKey: "test",
      events: [
        {
          name: "examples/065-checkpointing-opt-out/demo/checkpoint-opt-out",
          data: {
            tag: "opt-out-065",
          },
        },
      ],
      expect: [
        {
          spans: ["a", "b"],
          functionTag: "checkpoint-opt-out",
        },
      ],
    }),
  ],
});
