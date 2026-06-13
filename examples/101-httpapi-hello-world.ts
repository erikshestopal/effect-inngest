import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { InngestFunction, InngestGroup } from "effect-inngest";
import { defineExample, eventCase } from "./_support.ts";

class DemoHello extends Schema.TaggedClass<DemoHello>()("demo/hello", {
  name: Schema.String,
}) {}

const HelloFn = InngestFunction.make("hello-world", {
  trigger: { event: DemoHello },
  success: Schema.Struct({ greeting: Schema.String }),
});

const Group = InngestGroup.make(HelloFn);

const HandlersLive = Group.toLayer({
  "hello-world": ({ event }) => Effect.succeed({ greeting: `Hello, ${event.name}!` }),
});

export default defineExample({
  id: "101-httpapi-hello-world",
  group: Group,
  handlers: HandlersLive,
  cases: [
    eventCase({
      events: [
        {
          name: "demo/hello",
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
