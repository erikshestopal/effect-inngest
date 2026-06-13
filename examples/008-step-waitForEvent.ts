import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { InngestFunction, InngestGroup } from "effect-inngest";
import { defineExample, eventCase } from "./_support.ts";

class DemoWaitStart extends Schema.TaggedClass<DemoWaitStart>()("demo/wait-start", {
  orderId: Schema.String,
}) {}

class DemoWaitComplete extends Schema.TaggedClass<DemoWaitComplete>()("demo/wait-complete", {
  orderId: Schema.String,
  status: Schema.String,
}) {}

const WaitForEventFn = InngestFunction.make("wait-for-event", {
  trigger: { event: DemoWaitStart },
  success: Schema.Struct({ receivedStatus: Schema.NullOr(Schema.String) }),
});

const Group = InngestGroup.make(WaitForEventFn);

const HandlersLive = Group.toLayer({
  "wait-for-event": ({ event, step }) =>
    Effect.gen(function* () {
      const eventOption = yield* step.waitForEvent("wait-for-complete", DemoWaitComplete, {
        timeout: Duration.minutes(5),
        if: `async.data.orderId == "${event.orderId}"`,
      });
      return { receivedStatus: Option.isSome(eventOption) ? eventOption.value.status : null };
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
          name: "demo/wait-start",
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
              name: "demo/wait-complete",
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
