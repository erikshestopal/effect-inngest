import { defineNativeExample, eventCase } from "./_support.ts";

export default defineNativeExample((inngest) => {
  const LongTaskFn = inngest.createFunction(
    {
      id: "long-task",
      triggers: [{ event: "task/started" }],
      cancelOn: [{ event: "task/cancelled", if: "async.data.taskId == event.data.taskId" }],
    },
    async ({ event, step }) => {
      const taskId = typeof event.data.taskId === "string" ? event.data.taskId : "";
      await step.run("step-1", async () => `Started task ${taskId}`);
      await step.sleep("wait-1", "3s");
      await step.run("step-2", async () => "Still running...");
      await step.sleep("wait-2", "3s");
      await step.run("step-3", async () => "Almost done...");
      return { status: "completed" };
    },
  );

  return {
    id: "021-cancelOn-event",
    functions: [LongTaskFn],
    cases: [
      eventCase({
        events: [{ name: "task/started", data: { taskId: "task-021" } }],
        expect: [{ functionId: "examples-021-cancelOn-event-long-task" }],
      }),
    ],
  };
});
