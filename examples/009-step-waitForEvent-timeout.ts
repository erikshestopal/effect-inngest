import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { InngestFunction, InngestGroup, InngestEvent } from "effect-inngest";
import { defineExample, eventCase } from "./_support.ts";

const DemoWaitTimeout = InngestEvent.make(
  "demo/wait-timeout",
  Schema.Struct({
    orderId: Schema.String,
  }),
);

const DemoTimeoutSignal = InngestEvent.make(
  "demo/timeout-signal",
  Schema.Struct({
    orderId: Schema.String,
  }),
);

const WaitTimeoutFn = InngestFunction.make("wait-timeout", {
  trigger: { event: DemoWaitTimeout },
  success: Schema.Struct({ timedOut: Schema.Boolean }),
});

const Group = InngestGroup.make(WaitTimeoutFn);

const HandlersLive = Group.toLayer({
  "wait-timeout": ({ event, step }) =>
    Effect.gen(function* () {
      const eventOption = yield* step.waitForEvent("wait-for-signal", DemoTimeoutSignal, {
        timeout: Duration.seconds(5),
        if: `async.data.orderId == "${event.data.orderId}"`,
      });
      return { timedOut: Option.isNone(eventOption) };
    }),
});

export default defineExample({
  id: "009-step-waitForEvent-timeout",
  group: Group,
  handlers: HandlersLive,
  cases: [
    eventCase({
      events: [
        {
          name: "demo/wait-timeout",
          data: {
            orderId: "timeout-009",
          },
        },
      ],
      expect: [
        {
          spans: ["wait-for-signal"],
          functionTag: "wait-timeout",
        },
      ],
      timeoutMs: 20000,
    }),
  ],
});
