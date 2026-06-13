import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { InngestFunction, InngestGroup } from "effect-inngest";
import { defineExample, eventCase } from "./_support.ts";

class DemoSendBatch extends Schema.TaggedClass<DemoSendBatch>()("demo/send-batch", {}) {}

class DemoNotification extends Schema.TaggedClass<DemoNotification>()("demo/notification", {
  userId: Schema.String,
  message: Schema.String,
}) {}

const SendBatchFn = InngestFunction.make("send-batch", {
  trigger: { event: DemoSendBatch },
  success: Schema.Struct({ sentCount: Schema.Number }),
});

const Group = InngestGroup.make(SendBatchFn);

const HandlersLive = Group.toLayer({
  "send-batch": ({ step }) =>
    Effect.gen(function* () {
      yield* Effect.log("Sending batch of notifications...");

      yield* step.sendEvent("send-notifications", [
        new DemoNotification({ userId: "u1", message: "First notification" }),
        new DemoNotification({ userId: "u2", message: "Second notification" }),
        new DemoNotification({ userId: "u3", message: "Third notification" }),
      ]);

      yield* Effect.log("Batch sent successfully!");
      return { sentCount: 3 };
    }),
});

export default defineExample({
  id: "042-sendEvent-batch",
  group: Group,
  handlers: HandlersLive,
  cases: [
    eventCase({
      eventKey: "test",
      events: [
        {
          name: "demo/send-batch",
          data: {},
        },
      ],
      expect: [
        {
          spans: ["send-notifications"],
          functionTag: "send-batch",
        },
      ],
    }),
  ],
});
