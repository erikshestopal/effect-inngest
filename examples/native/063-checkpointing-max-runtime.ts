import { defineNativeExample, eventCase } from "./_support.ts";

const slow = (label: string) => async (): Promise<string> => {
  await new Promise((resolve) => setTimeout(resolve, 200));
  return label;
};

export default defineNativeExample((inngest) => {
  const Fn = inngest.createFunction(
    {
      id: "checkpoint-deadline",
      triggers: [{ event: "examples/063-checkpointing-max-runtime/demo/checkpoint-deadline" }],
      checkpointing: { bufferedSteps: 1, maxRuntime: 500 },
    },
    async ({ step }) => {
      await step.run("s1", slow("s1"));
      await step.run("s2", slow("s2"));
      await step.run("s3", slow("s3"));
      await step.run("s4", slow("s4"));
      await step.run("s5", slow("s5"));
      return { count: 5 };
    },
  );

  return {
    id: "063-checkpointing-max-runtime",
    functions: [Fn],
    cases: [
      eventCase({
        eventKey: "test",
        events: [
          { name: "examples/063-checkpointing-max-runtime/demo/checkpoint-deadline", data: { runId: "deadline-063" } },
        ],
        expect: [{ functionId: "examples-063-checkpointing-max-runtime-checkpoint-deadline" }],
      }),
    ],
  };
});
