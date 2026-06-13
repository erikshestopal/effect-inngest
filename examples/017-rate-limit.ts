import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { InngestFunction, InngestGroup } from "effect-inngest";
import { defineExample, eventCase } from "./_support.ts";

class DemoRateLimited extends Schema.TaggedClass<DemoRateLimited>()("demo/rate-limited", {
  id: Schema.String,
}) {}

const RateLimitedFn = InngestFunction.make("rate-limited-fn", {
  trigger: { event: DemoRateLimited },
  success: Schema.Struct({ id: Schema.String, processedAt: Schema.String }),
  rateLimit: { limit: 1, period: "1 second" },
});

const Group = InngestGroup.make(RateLimitedFn);

const HandlersLive = Group.toLayer({
  "rate-limited-fn": ({ event }) =>
    Effect.gen(function* () {
      yield* Effect.log(`Processing rate-limited event id: ${event.id}`);
      return { id: event.id, processedAt: new Date().toISOString() };
    }),
});

export default defineExample({
  id: "017-rate-limit",
  group: Group,
  handlers: HandlersLive,
  cases: [
    eventCase({
      events: [
        {
          name: "demo/rate-limited",
          data: {
            id: "rate-017",
          },
        },
      ],
      expect: [
        {
          functionTag: "rate-limited-fn",
        },
      ],
    }),
  ],
});
