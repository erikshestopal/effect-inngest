import { defineExample, eventCase } from "./_support.ts";
/**
 * Spec §10.4.1 — async checkpointing with default config.
 *
 * Three sequential `step.run` calls. With `bufferedSteps: 1` (default), each
 * step is flushed via POST /v1/checkpoint/{runId}/async. The final 206 carries
 * only `RunComplete` — verify in the dev-server timeline that the run completes
 * after a single Call Request rather than N round trips.
 */
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { InngestFunction, InngestGroup, InngestEvent } from "effect-inngest";

const BasicEvent = InngestEvent.make(
  "examples/060-checkpointing-basic/demo/checkpoint-basic",
  Schema.Struct({
    value: Schema.Number,
  }),
);

const Fn = InngestFunction.make("checkpoint-basic", {
  trigger: { event: BasicEvent },
  success: Schema.Struct({ doubled: Schema.Number, tripled: Schema.Number, total: Schema.Number }),
});

const Group = InngestGroup.make(Fn);

const HandlersLive = Group.toLayer({
  "checkpoint-basic": ({ event, step }) =>
    Effect.gen(function* () {
      const doubled = yield* step.run("double", Effect.succeed(event.data.value * 2), { schema: Schema.Number });
      const tripled = yield* step.run("triple", Effect.succeed(event.data.value * 3), { schema: Schema.Number });
      const total = yield* step.run("sum", Effect.succeed(doubled + tripled), { schema: Schema.Number });
      return { doubled, tripled, total };
    }),
});

export default defineExample({
  id: "060-checkpointing-basic",
  group: Group,
  handlers: HandlersLive,
  cases: [
    eventCase({
      eventKey: "test",
      events: [
        {
          name: "examples/060-checkpointing-basic/demo/checkpoint-basic",
          data: {
            value: 4,
          },
        },
      ],
      expect: [
        {
          spans: ["double", "triple", "sum"],
          functionTag: "checkpoint-basic",
        },
      ],
    }),
  ],
});
