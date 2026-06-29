import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { InngestFunction, InngestGroup, InngestEvent } from "effect-inngest";
import { defineExample, eventCase } from "./_support.ts";

const DemoThrottleKeyed = InngestEvent.make(
  "examples/046-throttle-key/demo/throttle-keyed",
  Schema.Struct({
    teamId: Schema.String,
  }),
);

const ThrottleKeyedFn = InngestFunction.make("throttle-keyed", {
  trigger: { event: DemoThrottleKeyed },
  throttle: {
    limit: 1,
    period: "1 second",
    key: "event.data.teamId",
  },
});

const Group = InngestGroup.make(ThrottleKeyedFn);

const HandlersLive = Group.toLayer({
  "throttle-keyed": ({ event }) =>
    Effect.gen(function* () {
      yield* Effect.log(`Processing throttled event for team: ${event.data.teamId}`);
      return {
        teamId: event.data.teamId,
        processedAt: new Date().toISOString(),
      };
    }),
});

export default defineExample({
  id: "046-throttle-key",
  group: Group,
  handlers: HandlersLive,
  cases: [
    eventCase({
      events: [
        {
          name: "examples/046-throttle-key/demo/throttle-keyed",
          data: {
            teamId: "team-046",
          },
        },
      ],
      expect: [
        {
          functionTag: "throttle-keyed",
        },
      ],
    }),
  ],
});
