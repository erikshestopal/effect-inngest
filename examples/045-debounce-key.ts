import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { InngestFunction, InngestGroup } from "effect-inngest";
import { defineExample, eventCase } from "./_support.ts";

class DemoDebounceKeyed extends Schema.TaggedClass<DemoDebounceKeyed>()("demo/debounce-keyed", {
  userId: Schema.String,
  action: Schema.String,
}) {}

const DebounceKeyedFn = InngestFunction.make("debounce-keyed", {
  trigger: { event: DemoDebounceKeyed },
  success: Schema.Struct({ userId: Schema.String, action: Schema.String, processedAt: Schema.String }),
  debounce: {
    period: "1 second",
    key: "event.data.userId",
  },
});

const Group = InngestGroup.make(DebounceKeyedFn);

const HandlersLive = Group.toLayer({
  "debounce-keyed": ({ event }) =>
    Effect.gen(function* () {
      yield* Effect.log(`Processing debounced action for user ${event.userId}: ${event.action}`);
      return {
        userId: event.userId,
        action: event.action,
        processedAt: new Date().toISOString(),
      };
    }),
});

export default defineExample({
  id: "045-debounce-key",
  group: Group,
  handlers: HandlersLive,
  cases: [
    eventCase({
      events: [
        {
          name: "demo/debounce-keyed",
          data: {
            userId: "user-045",
            action: "update",
          },
        },
      ],
      expect: [
        {
          functionTag: "debounce-keyed",
        },
      ],
      timeoutMs: 20000,
    }),
  ],
});
