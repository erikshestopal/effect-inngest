import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { InngestFunction, InngestGroup, InngestEvent } from "effect-inngest";
import { defineExample, eventCase } from "./_support.ts";

const DemoConcurrent = InngestEvent.make(
  "examples/014-concurrency-limit/demo/concurrent",
  Schema.Struct({
    id: Schema.String,
  }),
);

const ConcurrentFn = InngestFunction.make("concurrent-fn", {
  trigger: { event: DemoConcurrent },
  concurrency: { limit: 1 },
});

const Group = InngestGroup.make(ConcurrentFn);

const HandlersLive = Group.toLayer({
  "concurrent-fn": ({ event, step }) =>
    Effect.gen(function* () {
      yield* Effect.log(`Starting execution for id: ${event.data.id}`);
      yield* step.sleep("wait-1s", "1 second");
      yield* Effect.log(`Completed execution for id: ${event.data.id}`);
      return { id: event.data.id, completedAt: new Date().toISOString() };
    }),
});

export default defineExample({
  id: "014-concurrency-limit",
  group: Group,
  handlers: HandlersLive,
  cases: [
    eventCase({
      events: [
        {
          name: "examples/014-concurrency-limit/demo/concurrent",
          data: {
            id: "concurrent-014",
          },
        },
      ],
      expect: [
        {
          spans: ["wait-1s"],
          functionTag: "concurrent-fn",
        },
      ],
      timeoutMs: 20000,
    }),
  ],
});
