import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { InngestFunction, InngestGroup, InngestEvent } from "effect-inngest";
import { defineExample, eventCase } from "./_support.ts";

const ItemSchema = Schema.Struct({
  id: Schema.String,
  value: Schema.Number,
});

const ProcessedItemSchema = Schema.Struct({
  id: Schema.String,
  processedValue: Schema.Number,
});

const DemoLargePayload = InngestEvent.make(
  "examples/039-large-payload/demo/large-payload",
  Schema.Struct({
    items: Schema.Array(ItemSchema),
  }),
);

const LargePayloadFn = InngestFunction.make("process-large-payload", {
  trigger: { event: DemoLargePayload },
  success: Schema.Struct({
    itemCount: Schema.Number,
    totalValue: Schema.Number,
    processedIds: Schema.Array(Schema.String),
  }),
});

const Group = InngestGroup.make(LargePayloadFn);

const HandlersLive = Group.toLayer({
  "process-large-payload": ({ event, step }) =>
    Effect.gen(function* () {
      const processedItems = yield* step.run(
        "process-all-items",
        Effect.succeed(
          event.data.items.map((item) => ({
            id: item.id,
            processedValue: item.value * 2,
          })),
        ),
        { schema: Schema.Array(ProcessedItemSchema) },
      );

      const totalValue = yield* step.run(
        "calculate-total",
        Effect.succeed(event.data.items.reduce((sum, item) => sum + item.value, 0)),
        { schema: Schema.Number },
      );

      return {
        itemCount: event.data.items.length,
        totalValue,
        processedIds: processedItems.map((p) => p.id),
      };
    }),
});

export default defineExample({
  id: "039-large-payload",
  group: Group,
  handlers: HandlersLive,
  cases: [
    eventCase({
      events: [
        {
          name: "examples/039-large-payload/demo/large-payload",
          data: {
            items: [
              {
                id: "a",
                value: 1,
              },
              {
                id: "b",
                value: 2,
              },
            ],
          },
        },
      ],
      expect: [
        {
          spans: ["process-all-items", "calculate-total"],
          functionTag: "process-large-payload",
        },
      ],
    }),
  ],
});
