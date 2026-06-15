import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { InngestFunction, InngestGroup, InngestEvent } from "effect-inngest";
import { defineExample, eventCase } from "./_support.ts";

const DemoProcessItem = InngestEvent.make(
  "demo/process-item",
  Schema.Struct({
    itemId: Schema.String,
    userId: Schema.String,
  }),
);

const DemoSendNotification = InngestEvent.make(
  "demo/send-notification",
  Schema.Struct({
    userId: Schema.String,
    channel: Schema.Literals(["email", "sms", "push"]),
  }),
);

const ProcessItemFn = InngestFunction.make("process-item", {
  trigger: { event: DemoProcessItem },
  concurrency: {
    limit: 5,
    scope: "fn",
    key: "event.data.userId",
  },
  success: Schema.Struct({ processed: Schema.Boolean, itemId: Schema.String }),
});

const SendNotificationFn = InngestFunction.make("send-notification", {
  trigger: { event: DemoSendNotification },
  concurrency: {
    limit: 10,
    scope: "env",
    key: "event.data.userId",
  },
  success: Schema.Struct({ sent: Schema.Boolean, channel: Schema.String }),
});

const ExternalApiCallFn = InngestFunction.make("external-api-call", {
  trigger: { event: DemoProcessItem },
  concurrency: {
    limit: 2,
    scope: "account",
    key: "event.data.userId",
  },
  success: Schema.Struct({ apiCallComplete: Schema.Boolean }),
});

const Group = InngestGroup.make(ProcessItemFn, SendNotificationFn, ExternalApiCallFn);

const HandlersLive = Group.toLayer({
  "process-item": ({ event }) =>
    Effect.gen(function* () {
      yield* Effect.log(`Processing item ${event.data.itemId} for user ${event.data.userId}`);
      yield* Effect.sleep(Duration.millis(500));
      return { processed: true, itemId: event.data.itemId };
    }),

  "send-notification": ({ event }) =>
    Effect.gen(function* () {
      yield* Effect.log(`Sending ${event.data.channel} notification to ${event.data.userId}`);
      yield* Effect.sleep(Duration.millis(200));
      return { sent: true, channel: event.data.channel };
    }),

  "external-api-call": ({ event }) =>
    Effect.gen(function* () {
      yield* Effect.log(`Calling external API for item ${event.data.itemId}`);
      yield* Effect.sleep(Duration.seconds(1));
      return { apiCallComplete: true };
    }),
});

export default defineExample({
  id: "054-concurrency-scope",
  group: Group,
  handlers: HandlersLive,
  cases: [
    eventCase({
      eventKey: "test",
      events: [
        {
          name: "demo/process-item",
          data: {
            itemId: "item-054",
            userId: "user-054",
          },
        },
      ],
      expect: [
        {
          functionTag: "process-item",
        },
        {
          functionTag: "external-api-call",
        },
      ],
      timeoutMs: 30000,
    }),
  ],
});
