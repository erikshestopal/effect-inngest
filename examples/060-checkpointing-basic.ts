import { defineExample, eventCase } from "./_support.ts";
/**
 * Spec §10.4.1 — async checkpointing with default config.
 *
 * Three sequential `Inngest.run` calls. With `bufferedSteps: 1` (default), each
 * step is flushed via POST /v1/checkpoint/{runId}/async. The final 206 carries
 * only `RunComplete` — verify in the dev-server timeline that the run completes
 * after a single Call Request rather than N round trips.
 */
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { InngestFunction, InngestGroup, InngestEvent, Inngest } from "effect-inngest";

const BasicEvent = InngestEvent.make(
  "examples/060-checkpointing-basic/demo/checkpoint-basic",
  Schema.Struct({
    value: Schema.Number,
  }),
);

const Fn = InngestFunction.make("checkpoint-basic", {
  trigger: BasicEvent,
});

const Group = InngestGroup.make(Fn);

const HandlersLive = Group.toLayer({
  "checkpoint-basic": ({ event }) =>
    Effect.gen(function* () {
      const doubled = yield* Inngest.run("double", Effect.succeed(event.data.value * 2));
      const tripled = yield* Inngest.run("triple", Effect.succeed(event.data.value * 3));
      const total = yield* Inngest.run("sum", Effect.succeed(doubled + tripled));
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
