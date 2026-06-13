import { defineNativeExample, eventCase } from "./_support.ts";

export default defineNativeExample((inngest) => {
  const TriggerFailure = inngest.createFunction(
    {
      id: "trigger-failure",
      retries: 0,
      triggers: [{ event: "demo/trigger-failure" }],
    },
    async ({ event }) => {
      if (event.data.shouldFail === true) {
        throw new Error("Intentional failure for testing");
      }
    },
  );

  const HandleFailure = inngest.createFunction(
    {
      id: "handle-failure",
      triggers: [{ event: "inngest/function.failed" }],
    },
    async ({ event, logger }) => {
      const functionId = typeof event.data.function_id === "string" ? event.data.function_id : "";
      const errorMessage =
        typeof event.data.error === "object" &&
        event.data.error !== null &&
        typeof (event.data.error as { message?: unknown }).message === "string"
          ? (event.data.error as { message: string }).message
          : "";
      logger.info(`Function ${functionId} failed with error: ${errorMessage}`);
      logger.info(`Original event: ${JSON.stringify(event.data.event)}`);
      return { handled: true, failedFunctionId: functionId };
    },
  );

  const TrackCompletion = inngest.createFunction(
    {
      id: "track-completion",
      triggers: [{ event: "inngest/function.finished" }],
    },
    async ({ event, logger }) => {
      const functionId = typeof event.data.function_id === "string" ? event.data.function_id : "";
      logger.info(`Function ${functionId} completed successfully`);
      logger.info(`Result: ${JSON.stringify(event.data.result)}`);
      return { tracked: true };
    },
  );

  const HandleCancellation = inngest.createFunction(
    {
      id: "handle-cancellation",
      triggers: [{ event: "inngest/function.cancelled" }],
    },
    async ({ event, logger }) => {
      const functionId = typeof event.data.function_id === "string" ? event.data.function_id : "";
      logger.info(`Function ${functionId} was cancelled`);
      return { cleanedUp: true };
    },
  );

  return {
    id: "055-system-events",
    functions: [TriggerFailure, HandleFailure, TrackCompletion, HandleCancellation],
    cases: [
      eventCase({
        events: [{ name: "demo/trigger-failure", data: { shouldFail: false } }],
        expect: [{ functionId: "examples-055-system-events-trigger-failure" }],
      }),
    ],
  };
});
