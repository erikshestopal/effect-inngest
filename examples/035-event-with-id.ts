import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { InngestFunction, InngestGroup, InngestEvent } from "effect-inngest";
import { defineExample, eventCase } from "./_support.ts";

const DemoIdempotentEvent = InngestEvent.make(
  "examples/035-event-with-id/demo/idempotent-event",
  Schema.Struct({
    data: Schema.String,
  }),
);

const IdempotentFn = InngestFunction.make("idempotent-handler", {
  trigger: { event: DemoIdempotentEvent },
  success: Schema.Struct({ processed: Schema.Boolean, eventId: Schema.String }),
});

const Group = InngestGroup.make(IdempotentFn);

const HandlersLive = Group.toLayer({
  "idempotent-handler": ({ event, run }) =>
    Effect.gen(function* () {
      yield* Effect.log(`Processing event, runId: ${run.id}, data: ${event.data}`);
      return { processed: true, eventId: run.id };
    }),
});

export default defineExample({
  id: "035-event-with-id",
  group: Group,
  handlers: HandlersLive,
  cases: [
    eventCase({
      events: [
        {
          name: "examples/035-event-with-id/demo/idempotent-event",
          data: {
            data: "payload-035",
          },
        },
      ],
      expect: [
        {
          functionTag: "idempotent-handler",
        },
      ],
    }),
  ],
});
