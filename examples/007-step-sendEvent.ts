import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { InngestFunction, InngestGroup } from "effect-inngest";
import { defineExample, eventCase } from "./_support.ts";

class DemoSendSingle extends Schema.TaggedClass<DemoSendSingle>()("demo/send-single", {
  userId: Schema.String,
}) {}

class DemoNotification extends Schema.TaggedClass<DemoNotification>()("demo/notification", {
  userId: Schema.String,
  message: Schema.String,
}) {}

const SendSingleFn = InngestFunction.make("send-single", {
  trigger: { event: DemoSendSingle },
  success: Schema.Struct({ sent: Schema.Boolean }),
});

const Group = InngestGroup.make(SendSingleFn);

const HandlersLive = Group.toLayer({
  "send-single": ({ event, step }) =>
    Effect.gen(function* () {
      yield* step.sendEvent(
        "send-notification",
        new DemoNotification({ userId: event.userId, message: "Hello from step.sendEvent!" }),
      );
      return { sent: true };
    }),
});

export default defineExample({
  id: "007-step-sendEvent",
  group: Group,
  handlers: HandlersLive,
  cases: [
    eventCase({
      eventKey: "test",
      events: [
        {
          name: "demo/send-single",
          data: {
            userId: "u_001",
          },
        },
      ],
      expect: [
        {
          spans: ["send-notification"],
          functionTag: "send-single",
        },
      ],
    }),
  ],
});
