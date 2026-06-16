import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { InngestFunction, InngestGroup, InngestEvent } from "effect-inngest";
import { defineExample, eventCase } from "./_support.ts";

const DemoDebounceKeyed = InngestEvent.make(
  "examples/045-debounce-key/demo/debounce-keyed",
  Schema.Struct({
    userId: Schema.String,
    action: Schema.String,
  }),
);

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
      yield* Effect.log(`Processing debounced action for user ${event.data.userId}: ${event.data.action}`);
      return {
        userId: event.data.userId,
        action: event.data.action,
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
          name: "examples/045-debounce-key/demo/debounce-keyed",
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
