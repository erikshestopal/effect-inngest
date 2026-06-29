import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { InngestFunction, InngestGroup, InngestEvent } from "effect-inngest";
import { defineExample, eventCase } from "./_support.ts";

const DemoHello = InngestEvent.make(
  "examples/101-httpapi-hello-world/demo/hello",
  Schema.Struct({
    name: Schema.String,
  }),
);

const HelloFn = InngestFunction.make("hello-world", {
  trigger: DemoHello,
});

const Group = InngestGroup.make(HelloFn);

const HandlersLive = Group.toLayer({
  "hello-world": ({ event }) => Effect.succeed({ greeting: `Hello, ${event.data.name}!` }),
});

export default defineExample({
  id: "101-httpapi-hello-world",
  group: Group,
  handlers: HandlersLive,
  cases: [
    eventCase({
      events: [
        {
          name: "examples/101-httpapi-hello-world/demo/hello",
          data: {
            name: "Amp",
          },
        },
      ],
      expect: [
        {
          functionTag: "hello-world",
        },
      ],
    }),
  ],
});
