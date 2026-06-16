import { defineNativeExample, eventCase } from "./_support.ts";

export default defineNativeExample((inngest) => {
  const Fn = inngest.createFunction(
    {
      id: "checkpoint-basic",
      triggers: [{ event: "examples/060-checkpointing-basic/demo/checkpoint-basic" }],
    },
    async ({ event, step }) => {
      const value = event.data.value as number;
      const doubled = await step.run("double", () => value * 2);
      const tripled = await step.run("triple", () => value * 3);
      const total = await step.run("sum", () => doubled + tripled);
      return { doubled, tripled, total };
    },
  );

  return {
    id: "060-checkpointing-basic",
    functions: [Fn],
    cases: [
      eventCase({
        eventKey: "test",
        events: [{ name: "examples/060-checkpointing-basic/demo/checkpoint-basic", data: { value: 4 } }],
        expect: [{ functionId: "examples-060-checkpointing-basic-checkpoint-basic" }],
      }),
    ],
  };
});
