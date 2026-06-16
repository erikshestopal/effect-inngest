import { defineNativeExample, eventCase } from "./_support.ts";

export default defineNativeExample((inngest) => {
  const Fn = inngest.createFunction(
    {
      id: "checkpoint-override",
      triggers: [{ event: "examples/064-checkpointing-fn-override/demo/checkpoint-override" }],
      checkpointing: { bufferedSteps: 1 },
    },
    async ({ event, step }) => {
      await step.run("a", () => "A");
      await step.run("b", () => "B");
      await step.run("c", () => "C");
      return { key: event.data.key as string };
    },
  );

  return {
    id: "064-checkpointing-fn-override",
    functions: [Fn],
    cases: [
      eventCase({
        eventKey: "test",
        events: [
          { name: "examples/064-checkpointing-fn-override/demo/checkpoint-override", data: { key: "override-064" } },
        ],
        expect: [{ functionId: "examples-064-checkpointing-fn-override-checkpoint-override" }],
      }),
    ],
  };
});
