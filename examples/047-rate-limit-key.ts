import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { InngestFunction, InngestGroup, InngestEvent } from "effect-inngest";
import { defineExample, eventCase } from "./_support.ts";

const DemoRateKeyed = InngestEvent.make(
  "examples/047-rate-limit-key/demo/rate-keyed",
  Schema.Struct({
    companyId: Schema.String,
  }),
);

const RateLimitKeyedFn = InngestFunction.make("rate-limit-keyed", {
  trigger: DemoRateKeyed,
  rateLimit: {
    limit: 2,
    period: "1 minute",
    key: "event.data.companyId",
  },
});

const Group = InngestGroup.make(RateLimitKeyedFn);

const HandlersLive = Group.toLayer({
  "rate-limit-keyed": ({ event }) =>
    Effect.gen(function* () {
      yield* Effect.log(`Processing rate-limited event for company: ${event.data.companyId}`);
      return {
        companyId: event.data.companyId,
        processedAt: new Date().toISOString(),
      };
    }),
});

export default defineExample({
  id: "047-rate-limit-key",
  group: Group,
  handlers: HandlersLive,
  cases: [
    eventCase({
      events: [
        {
          name: "examples/047-rate-limit-key/demo/rate-keyed",
          data: {
            companyId: "company-047",
          },
        },
      ],
      expect: [
        {
          functionTag: "rate-limit-keyed",
        },
      ],
    }),
  ],
});
