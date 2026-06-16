import { defineNativeExample, eventCase } from "./_support.ts";

export default defineNativeExample((inngest) => {
  const Fn = inngest.createFunction(
    {
      id: "checkpoint-opt-out",
      triggers: [{ event: "examples/065-checkpointing-opt-out/demo/checkpoint-opt-out" }],
      checkpointing: false,
    },
    async ({ event, step }) => {
      await step.run("a", () => "A");
      await step.run("b", () => "B");
      return { tag: event.data.tag as string };
    },
  );

  return {
    id: "065-checkpointing-opt-out",
    functions: [Fn],
    cases: [
      eventCase({
        eventKey: "test",
        events: [{ name: "examples/065-checkpointing-opt-out/demo/checkpoint-opt-out", data: { tag: "opt-out-065" } }],
        expect: [{ functionId: "examples-065-checkpointing-opt-out-checkpoint-opt-out" }],
      }),
    ],
  };
});
