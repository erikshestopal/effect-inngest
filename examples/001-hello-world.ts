import * as Effect from "effect/Effect";
import { Predicate } from "effect";
import * as Schema from "effect/Schema";
import { InngestFunction, InngestGroup, InngestEvent } from "effect-inngest";
import { defineExample, eventCase } from "./_support.ts";

const DemoHello = InngestEvent.make("demo/hello", Schema.Struct({ name: Schema.String }));
const DemoBye = InngestEvent.make("demo/bye", Schema.Struct({ lastName: Schema.Number }));

const HelloFn = InngestFunction.make("hello-world", {
  trigger: [{ event: DemoHello }, { event: DemoBye }],
  success: Schema.Struct({ greeting: Schema.String }),
});

const Group = InngestGroup.make(HelloFn);

const HelloFnHandler = Group.toLayerHandler("hello-world", ({ event }) =>
  Effect.gen(function* () {
    const greetingName = event.name === "demo/hello" ? event.data.name : "Guest";
    yield* Effect.log(`hello-world greeting ${greetingName}`);
    return { greeting: `Hello, ${greetingName}!` };
  }).pipe(Effect.withSpan("example/hello-world"), Effect.withLogSpan("example/hello-world")),
);

export default defineExample({
  id: "001-hello-world",
  group: Group,
  handlers: HelloFnHandler,
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
