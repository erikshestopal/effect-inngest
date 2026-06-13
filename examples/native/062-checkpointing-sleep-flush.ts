import { defineNativeExample, eventCase } from "./_support.ts";

export default defineNativeExample((inngest) => {
  const Fn = inngest.createFunction(
    {
      id: "checkpoint-sleep",
      triggers: [{ event: "demo/checkpoint-sleep" }],
      checkpointing: { bufferedSteps: 10 },
    },
    async ({ event, step }) => {
      await step.run("prepare-a", () => "a");
      await step.run("prepare-b", () => "b");
      await step.sleep("nap", "2s");
      return { tag: event.data.tag as string };
    },
  );

  return {
    id: "062-checkpointing-sleep-flush",
    functions: [Fn],
    cases: [
      eventCase({
        eventKey: "test",
        events: [{ name: "demo/checkpoint-sleep", data: { tag: "sleep-062" } }],
        expect: [{ functionId: "examples-062-checkpointing-sleep-flush-checkpoint-sleep" }],
      }),
    ],
  };
});
