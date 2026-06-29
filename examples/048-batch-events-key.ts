import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { InngestFunction, InngestGroup, InngestEvent } from "effect-inngest";
import { defineExample, eventCase } from "./_support.ts";

const DemoBatchKeyed = InngestEvent.make(
  "examples/048-batch-events-key/demo/batch-keyed",
  Schema.Struct({
    userId: Schema.String,
    item: Schema.String,
  }),
);

const BatchKeyedFn = InngestFunction.make("batch-keyed", {
  trigger: { event: DemoBatchKeyed },
  batchEvents: {
    maxSize: 10,
    timeout: "1 second",
    key: "event.data.userId",
  },
});

const Group = InngestGroup.make(BatchKeyedFn);

const HandlersLive = Group.toLayer({
  "batch-keyed": ({ event }) =>
    Effect.gen(function* () {
      const events = event as unknown as ReadonlyArray<InngestEvent.EventType<typeof DemoBatchKeyed>>;
      const userId = events[0]?.data.userId ?? "unknown";
      const items = events.map((e) => e.data.item);

      yield* Effect.log(`Processing batch for user ${userId}: ${items.join(", ")}`);
      return {
        userId,
        items,
        count: events.length,
      };
    }),
});

export default defineExample({
  id: "048-batch-events-key",
  group: Group,
  handlers: HandlersLive,
  cases: [
    eventCase({
      events: [
        {
          name: "examples/048-batch-events-key/demo/batch-keyed",
          data: {
            userId: "user-048",
            item: "a",
          },
        },
        {
          name: "examples/048-batch-events-key/demo/batch-keyed",
          data: {
            userId: "user-048",
            item: "b",
          },
        },
      ],
      expect: [
        {
          functionTag: "batch-keyed",
        },
      ],
      timeoutMs: 20000,
    }),
  ],
});
