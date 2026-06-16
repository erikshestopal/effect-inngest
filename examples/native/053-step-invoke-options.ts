import { defineNativeExample, eventCase } from "./_support.ts";

export default defineNativeExample((inngest) => {
  const WorkerFn = inngest.createFunction(
    {
      id: "worker-task",
      retries: 3,
      triggers: [{ event: "examples/053-step-invoke-options/demo/worker-task" }],
    },
    async ({ event, logger }) => {
      const taskId = typeof event.data.taskId === "string" ? event.data.taskId : "";
      const priority = typeof event.data.priority === "string" ? event.data.priority : "normal";
      logger.info(`Worker processing task: ${taskId}, priority: ${priority}`);
      await new Promise((resolve) => setTimeout(resolve, 100));
      return { completed: true, taskId };
    },
  );

  const OrchestratorFn = inngest.createFunction(
    {
      id: "orchestrator",
      triggers: [{ event: "examples/053-step-invoke-options/demo/orchestrate" }],
    },
    async ({ event, step, logger }) => {
      const taskId = typeof event.data.taskId === "string" ? event.data.taskId : "";
      logger.info(`Orchestrating task: ${taskId}`);

      const result = await step.invoke("invoke-worker", {
        function: WorkerFn,
        data: { taskId, priority: "high" },
        timeout: "30s",
      });

      logger.info(`Worker completed: ${JSON.stringify(result)}`);

      const batchResult = await step.invoke("invoke-batch-worker", {
        function: WorkerFn,
        data: { taskId: `${taskId}-batch`, priority: "low" },
        timeout: "5m",
      });

      return { orchestrated: true, workerResult: result, batchResult };
    },
  );

  return {
    id: "053-step-invoke-options",
    functions: [WorkerFn, OrchestratorFn],
    cases: [
      eventCase({
        eventKey: "test",
        events: [{ name: "examples/053-step-invoke-options/demo/orchestrate", data: { taskId: "task-053" } }],
        expect: [{ functionId: "examples-053-step-invoke-options-orchestrator" }],
      }),
    ],
  };
});
