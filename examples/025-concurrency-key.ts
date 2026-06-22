import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { InngestFunction, InngestGroup, InngestEvent } from "effect-inngest";
import { defineExample, eventCase } from "./_support.ts";

const DemoConcurrentKeyed = InngestEvent.make(
  "examples/025-concurrency-key/demo/concurrent-keyed",
  Schema.Struct({
    userId: Schema.String,
  }),
);

const KeyedConcurrentFn = InngestFunction.make("user-processor", {
  trigger: { event: DemoConcurrentKeyed },
  concurrency: { limit: 1, key: "event.data.userId" },
  success: Schema.Struct({ processed: Schema.String }),
});

const Group = InngestGroup.make(KeyedConcurrentFn);

const HandlersLive = Group.toLayer({
  "user-processor": ({ event, step }) =>
    Effect.gen(function* () {
      yield* step.run("process", Effect.succeed(`Processing ${event.data.userId}`), { schema: Schema.String });
      yield* step.sleep("simulate-work", Duration.seconds(1));
      return { processed: event.data.userId };
    }),
});

export default defineExample({
  id: "025-concurrency-key",
  group: Group,
  handlers: HandlersLive,
  cases: [
    eventCase({
      events: [
        {
          name: "examples/025-concurrency-key/demo/concurrent-keyed",
          data: {
            userId: "user-025",
          },
        },
      ],
      expect: [
        {
          spans: ["process", "simulate-work"],
          functionTag: "user-processor",
        },
      ],
      timeoutMs: 20000,
    }),
  ],
});
