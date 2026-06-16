import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { InngestFunction, InngestGroup, InngestEvent } from "effect-inngest";
import { defineExample, eventCase } from "./_support.ts";

const DemoBatched = InngestEvent.make(
  "examples/018-batch-events/demo/batched",
  Schema.Struct({
    n: Schema.Number,
  }),
);

const BatchedFn = InngestFunction.make("batched-fn", {
  trigger: { event: DemoBatched },
  success: Schema.Struct({ count: Schema.Number, sum: Schema.Number }),
  batchEvents: { maxSize: 5, timeout: "1 second" },
});

const Group = InngestGroup.make(BatchedFn);

const HandlersLive = Group.toLayer({
  "batched-fn": ({ event }) =>
    Effect.gen(function* () {
      const events = event as unknown as ReadonlyArray<InngestEvent.EventType<typeof DemoBatched>>;
      yield* Effect.log(`Processing batch of ${events.length} events: ${JSON.stringify(events)}`);
      const sum = events.reduce((acc, e) => acc + e.data.n, 0);
      return { count: events.length, sum };
    }),
});

export default defineExample({
  id: "018-batch-events",
  group: Group,
  handlers: HandlersLive,
  cases: [
    eventCase({
      events: [
        {
          name: "examples/018-batch-events/demo/batched",
          data: {
            n: 2,
          },
        },
      ],
      expect: [
        {
          functionTag: "batched-fn",
        },
      ],
      timeoutMs: 20000,
    }),
  ],
});
