import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { InngestFunction, InngestGroup } from "effect-inngest";
import { defineExample, eventCase } from "./_support.ts";

class DemoConcurrent extends Schema.TaggedClass<DemoConcurrent>()("demo/concurrent", {
  id: Schema.String,
}) {}

const ConcurrentFn = InngestFunction.make("concurrent-fn", {
  trigger: { event: DemoConcurrent },
  success: Schema.Struct({ id: Schema.String, completedAt: Schema.String }),
  concurrency: { limit: 1 },
});

const Group = InngestGroup.make(ConcurrentFn);

const HandlersLive = Group.toLayer({
  "concurrent-fn": ({ event, step }) =>
    Effect.gen(function* () {
      yield* Effect.log(`Starting execution for id: ${event.id}`);
      yield* step.sleep("wait-1s", "1 second");
      yield* Effect.log(`Completed execution for id: ${event.id}`);
      return { id: event.id, completedAt: new Date().toISOString() };
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
          name: "demo/concurrent",
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
