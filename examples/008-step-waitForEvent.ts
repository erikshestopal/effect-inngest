import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { InngestFunction, InngestGroup, InngestEvent } from "effect-inngest";
import { defineExample, eventCase } from "./_support.ts";

const DemoWaitStart = InngestEvent.make(
  "examples/008-step-waitForEvent/demo/wait-start",
  Schema.Struct({
    orderId: Schema.String,
  }),
);

const DemoWaitComplete = InngestEvent.make(
  "examples/008-step-waitForEvent/demo/wait-complete",
  Schema.Struct({
    orderId: Schema.String,
    status: Schema.String,
  }),
);

const WaitForEventFn = InngestFunction.make("wait-for-event", {
  trigger: { event: DemoWaitStart },
});

const Group = InngestGroup.make(WaitForEventFn);

const HandlersLive = Group.toLayer({
  "wait-for-event": ({ event, step }) =>
    Effect.gen(function* () {
      const eventOption = yield* step.waitForEvent("wait-for-complete", DemoWaitComplete, {
        timeout: Duration.minutes(5),
        if: `async.data.orderId == "${event.data.orderId}"`,
      });
      return { receivedStatus: Option.isSome(eventOption) ? eventOption.value.data.status : null };
    }),
});

export default defineExample({
  id: "008-step-waitForEvent",
  group: Group,
  handlers: HandlersLive,
  cases: [
    eventCase({
      events: [
        {
          name: "examples/008-step-waitForEvent/demo/wait-start",
          data: {
            orderId: "order-008",
          },
        },
      ],
      afterEvents: [
        {
          delayMs: 1000,
          events: [
            {
              name: "examples/008-step-waitForEvent/demo/wait-complete",
              data: {
                orderId: "order-008",
                status: "approved",
              },
            },
          ],
        },
      ],
      expect: [
        {
          spans: ["wait-for-complete"],
          functionTag: "wait-for-event",
        },
      ],
      timeoutMs: 30000,
    }),
  ],
});
