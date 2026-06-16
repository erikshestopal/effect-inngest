import { defineNativeExample, eventCase } from "./_support.ts";

interface PayloadItem {
  readonly id: string;
  readonly value: number;
}

export default defineNativeExample((inngest) => {
  const ProcessLargePayload = inngest.createFunction(
    {
      id: "process-large-payload",
      triggers: [{ event: "examples/039-large-payload/demo/large-payload" }],
    },
    async ({ event, step }) => {
      const items: ReadonlyArray<PayloadItem> = Array.isArray(event.data.items) ? event.data.items : [];

      const processedItems = await step.run("process-all-items", () =>
        items.map((item) => ({ id: item.id, processedValue: item.value * 2 })),
      );

      const totalValue = await step.run("calculate-total", () => items.reduce((sum, item) => sum + item.value, 0));

      return {
        itemCount: items.length,
        totalValue,
        processedIds: processedItems.map((p) => p.id),
      };
    },
  );

  return {
    id: "039-large-payload",
    functions: [ProcessLargePayload],
    cases: [
      eventCase({
        events: [
          {
            name: "examples/039-large-payload/demo/large-payload",
            data: {
              items: [
                { id: "a", value: 1 },
                { id: "b", value: 2 },
              ],
            },
          },
        ],
        expect: [{ functionId: "examples-039-large-payload-process-large-payload" }],
      }),
    ],
  };
});
