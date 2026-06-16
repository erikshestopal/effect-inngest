import { defineNativeExample, eventCase } from "./_support.ts";

export default defineNativeExample((inngest) => {
  const Fn = inngest.createFunction(
    {
      id: "checkpoint-buffered",
      triggers: [{ event: "examples/061-checkpointing-buffered-steps/demo/checkpoint-buffered" }],
      checkpointing: { bufferedSteps: 2 },
    },
    async ({ event, step }) => {
      const base = event.data.base as number;
      const a = await step.run("a", () => base + 1);
      const b = await step.run("b", () => base + 2);
      const c = await step.run("c", () => base + 3);
      const d = await step.run("d", () => base + 4);
      return { total: a + b + c + d };
    },
  );

  return {
    id: "061-checkpointing-buffered-steps",
    functions: [Fn],
    cases: [
      eventCase({
        eventKey: "test",
        events: [{ name: "examples/061-checkpointing-buffered-steps/demo/checkpoint-buffered", data: { base: 10 } }],
        expect: [{ functionId: "examples-061-checkpointing-buffered-steps-checkpoint-buffered" }],
      }),
    ],
  };
});
