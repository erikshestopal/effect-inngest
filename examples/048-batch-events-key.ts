import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { InngestFunction, InngestGroup } from "effect-inngest";
import { defineExample, eventCase } from "./_support.ts";

class DemoBatchKeyed extends Schema.TaggedClass<DemoBatchKeyed>()("demo/batch-keyed", {
  userId: Schema.String,
  item: Schema.String,
}) {}

const BatchKeyedFn = InngestFunction.make("batch-keyed", {
  trigger: { event: DemoBatchKeyed },
  success: Schema.Struct({ userId: Schema.String, items: Schema.Array(Schema.String), count: Schema.Number }),
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
      const events = event as unknown as ReadonlyArray<DemoBatchKeyed>;
      const userId = events[0]?.userId ?? "unknown";
      const items = events.map((e) => e.item);

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
          name: "demo/batch-keyed",
          data: {
            userId: "user-048",
            item: "a",
          },
        },
        {
          name: "demo/batch-keyed",
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
