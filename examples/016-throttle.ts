import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { InngestFunction, InngestGroup, InngestEvent } from "effect-inngest";
import { defineExample, eventCase } from "./_support.ts";

const DemoThrottled = InngestEvent.make(
  "demo/throttled",
  Schema.Struct({
    id: Schema.String,
  }),
);

const ThrottledFn = InngestFunction.make("throttled-fn", {
  trigger: { event: DemoThrottled },
  success: Schema.Struct({ id: Schema.String, processedAt: Schema.String }),
  throttle: { limit: 1, period: "1 second" },
});

const Group = InngestGroup.make(ThrottledFn);

const HandlersLive = Group.toLayer({
  "throttled-fn": ({ event }) =>
    Effect.gen(function* () {
      yield* Effect.log(`Processing throttled event id: ${event.data.id}`);
      return { id: event.data.id, processedAt: new Date().toISOString() };
    }),
});

export default defineExample({
  id: "016-throttle",
  group: Group,
  handlers: HandlersLive,
  cases: [
    eventCase({
      events: [
        {
          name: "demo/throttled",
          data: {
            id: "throttle-016",
          },
        },
      ],
      expect: [
        {
          functionTag: "throttled-fn",
        },
      ],
    }),
  ],
});
