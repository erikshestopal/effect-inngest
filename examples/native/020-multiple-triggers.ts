import { defineNativeExample, eventCase } from "./_support.ts";

export default defineNativeExample((inngest) => {
  const UserHandlerFn = inngest.createFunction(
    {
      id: "user-handler",
      triggers: [{ event: "user/created" }, { event: "user/updated" }],
    },
    async ({ event, logger }) => {
      const userId = typeof event.data.userId === "string" ? event.data.userId : "";
      const action = event.name === "user/created" ? "Created" : "Updated";
      logger.info(`User ${action}: ${userId}`);
      return { eventName: event.name, userId, action };
    },
  );

  return {
    id: "020-multiple-triggers",
    functions: [UserHandlerFn],
    cases: [
      eventCase({
        events: [{ name: "user/created", data: { userId: "user-020" } }],
        expect: [{ functionId: "examples-020-multiple-triggers-user-handler" }],
      }),
    ],
  };
});
