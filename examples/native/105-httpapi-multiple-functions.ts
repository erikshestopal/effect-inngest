import { defineNativeExample, eventCase } from "./_support.ts";

export default defineNativeExample((inngest) => {
  const OnUserCreated = inngest.createFunction(
    {
      id: "on-user-created",
      triggers: [{ event: "user/created" }],
    },
    async ({ event, step, logger }) => {
      const email = typeof event.data.email === "string" ? event.data.email : "unknown";
      await step.run("send-welcome", () => {
        logger.info(`Sending welcome to ${email}`);
      });
      return { welcomed: true };
    },
  );

  const OnUserDeleted = inngest.createFunction(
    {
      id: "on-user-deleted",
      triggers: [{ event: "user/deleted" }],
    },
    async ({ event, step, logger }) => {
      const userId = typeof event.data.userId === "string" ? event.data.userId : "unknown";
      await step.run("cleanup", () => {
        logger.info(`Cleaning up data for ${userId}`);
      });
      return { cleaned: true };
    },
  );

  return {
    id: "105-httpapi-multiple-functions",
    functions: [OnUserCreated, OnUserDeleted],
    cases: [
      eventCase({
        events: [{ name: "user/created", data: { userId: "user-105", email: "user@example.com" } }],
        expect: [{ functionId: "examples-105-httpapi-multiple-functions-on-user-created" }],
      }),
    ],
  };
});
