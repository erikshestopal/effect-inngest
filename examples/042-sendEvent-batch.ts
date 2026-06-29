import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { InngestFunction, InngestGroup, InngestEvent, Inngest } from "effect-inngest";
import { defineExample, eventCase } from "./_support.ts";

const DemoSendBatch = InngestEvent.make("examples/042-sendEvent-batch/demo/send-batch", Schema.Struct({}));

const DemoNotification = InngestEvent.make(
  "examples/042-sendEvent-batch/demo/notification",
  Schema.Struct({
    userId: Schema.String,
    message: Schema.String,
  }),
);

const SendBatchFn = InngestFunction.make("send-batch", {
  trigger: DemoSendBatch,
});

const Group = InngestGroup.make(SendBatchFn);

const HandlersLive = Group.toLayer({
  "send-batch": () =>
    Effect.gen(function* () {
      yield* Effect.log("Sending batch of notifications...");

      yield* Inngest.sendEvent("send-notifications", [
        DemoNotification.make({ userId: "u1", message: "First notification" }),
        DemoNotification.make({ userId: "u2", message: "Second notification" }),
        DemoNotification.make({ userId: "u3", message: "Third notification" }),
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
          name: "examples/042-sendEvent-batch/demo/send-batch",
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
