import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { InngestFunction, InngestGroup, InngestEvent } from "effect-inngest";
import { defineExample, eventCase } from "./_support.ts";

const DemoEcho = InngestEvent.make(
  "demo/echo",
  Schema.Struct({
    message: Schema.String,
  }),
);

const EchoFn = InngestFunction.make("echo-data", {
  trigger: { event: DemoEcho },
  success: Schema.Struct({ received: Schema.String }),
});

const Group = InngestGroup.make(EchoFn);

const HandlersLive = Group.toLayer({
  "echo-data": ({ event }) =>
    Effect.gen(function* () {
      yield* Effect.log(`echo-data received: ${event.data.message}`);
      return { received: event.data.message };
    }).pipe(Effect.withSpan("example/echo-data")),
});

export default defineExample({
  id: "002-return-event-data",
  group: Group,
  handlers: HandlersLive,
  cases: [
    eventCase({
      events: [
        {
          name: "demo/echo",
          data: {
            message: "hello from examples harness",
          },
        },
      ],
      expect: [
        {
          functionTag: "echo-data",
        },
      ],
    }),
  ],
});
