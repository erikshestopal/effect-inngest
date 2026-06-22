import { defineNativeExample, eventCase } from "./_support.ts";

export default defineNativeExample((inngest) => {
  const CancellableTask = inngest.createFunction(
    {
      id: "cancellable-task",
      triggers: [{ event: "examples/069-cancelOn-event-definition/task/started" }],
      cancelOn: [
        {
          event: "examples/069-cancelOn-event-definition/task/cancelled",
          if: "async.data.taskId == event.data.taskId",
        },
      ],
    },
    async ({ event, step }) => {
      const taskId = typeof event.data.taskId === "string" ? event.data.taskId : "";
      await step.run("record-start", async () => taskId);
      return { taskId, status: "completed" };
    },
  );

  return {
    id: "069-cancelOn-event-definition",
    functions: [CancellableTask],
    cases: [
      eventCase({
        events: [{ name: "examples/069-cancelOn-event-definition/task/started", data: { taskId: "task-069" } }],
        expect: [{ functionId: "examples-069-cancelOn-event-definition-cancellable-task" }],
      }),
    ],
  };
});
