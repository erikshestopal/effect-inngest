import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { InngestFunction, InngestGroup, InngestEvent } from "effect-inngest";
import { defineExample, eventCase } from "./_support.ts";

const DemoSendSingle = InngestEvent.make(
  "examples/007-step-sendEvent/demo/send-single",
  Schema.Struct({
    userId: Schema.String,
  }),
);

const DemoNotification = InngestEvent.make(
  "examples/007-step-sendEvent/demo/notification",
  Schema.Struct({
    userId: Schema.String,
    message: Schema.String,
  }),
);

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
        DemoNotification.make({ userId: event.data.userId, message: "Hello from step.sendEvent!" }),
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
          name: "examples/007-step-sendEvent/demo/send-single",
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
