import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { InngestFunction, InngestGroup, InngestEvent } from "effect-inngest";
import { defineExample, eventCase } from "./_support.ts";

const DemoSchemaSendStart = InngestEvent.make("examples/066-schema-sendEvent/demo/start", Schema.Struct({}));

const DemoSchemaNotification = InngestEvent.make(
  "examples/066-schema-sendEvent/demo/notification",
  Schema.Struct({
    url: Schema.URL,
  }),
);

const SchemaSendEventFn = InngestFunction.make("schema-sendEvent-demo", {
  trigger: { event: DemoSchemaSendStart },
});

const Group = InngestGroup.make(SchemaSendEventFn);

const HandlersLive = Group.toLayer({
  "schema-sendEvent-demo": ({ step }) =>
    Effect.gen(function* () {
      yield* step.sendEvent(
        "send-schema-event",
        DemoSchemaNotification.make({ url: new URL("https://example.com/send-event") }),
      );

      return { sent: true };
    }),
});

export default defineExample({
  id: "066-schema-sendEvent",
  group: Group,
  handlers: HandlersLive,
  cases: [
    eventCase({
      eventKey: "test",
      events: [
        {
          name: "examples/066-schema-sendEvent/demo/start",
          data: {},
        },
      ],
      expect: [
        {
          spans: ["send-schema-event"],
          functionTag: "schema-sendEvent-demo",
        },
      ],
    }),
  ],
});
