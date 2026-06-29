import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { InngestFunction, InngestGroup, InngestEvent } from "effect-inngest";
import { defineExample, eventCase } from "./_support.ts";

const DemoDebounced = InngestEvent.make(
  "examples/015-debounce/demo/debounced",
  Schema.Struct({
    seq: Schema.Number,
  }),
);

const DebouncedFn = InngestFunction.make("debounced-fn", {
  trigger: { event: DemoDebounced },
  debounce: { period: "1 second" },
});

const Group = InngestGroup.make(DebouncedFn);

const HandlersLive = Group.toLayer({
  "debounced-fn": ({ event }) =>
    Effect.gen(function* () {
      yield* Effect.log(`Processing debounced event with seq: ${event.data.seq}`);
      return { seq: event.data.seq, processedAt: new Date().toISOString() };
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
          name: "examples/015-debounce/demo/debounced",
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
