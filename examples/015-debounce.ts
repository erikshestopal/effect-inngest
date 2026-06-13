import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { InngestFunction, InngestGroup } from "effect-inngest";
import { defineExample, eventCase } from "./_support.ts";

class DemoDebounced extends Schema.TaggedClass<DemoDebounced>()("demo/debounced", {
  seq: Schema.Number,
}) {}

const DebouncedFn = InngestFunction.make("debounced-fn", {
  trigger: { event: DemoDebounced },
  success: Schema.Struct({ seq: Schema.Number, processedAt: Schema.String }),
  debounce: { period: "1 second" },
});

const Group = InngestGroup.make(DebouncedFn);

const HandlersLive = Group.toLayer({
  "debounced-fn": ({ event }) =>
    Effect.gen(function* () {
      yield* Effect.log(`Processing debounced event with seq: ${event.seq}`);
      return { seq: event.seq, processedAt: new Date().toISOString() };
    }),
});

export default defineExample({
  id: "015-debounce",
  group: Group,
  handlers: HandlersLive,
  cases: [
    eventCase({
      events: [
        {
          name: "demo/debounced",
          data: {
            seq: 1,
          },
        },
      ],
      expect: [
        {
          functionTag: "debounced-fn",
        },
      ],
      timeoutMs: 20000,
    }),
  ],
});
