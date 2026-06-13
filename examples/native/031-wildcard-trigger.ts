import { defineNativeExample, eventCase } from "./_support.ts";

export default defineNativeExample((inngest) => {
  const UserEvents = inngest.createFunction(
    {
      id: "handle-user-events",
      triggers: [{ event: "user.created" }, { event: "user.deleted" }],
    },
    async ({ event }) => {
      const userId = typeof event.data.userId === "string" ? event.data.userId : "";
      return { eventType: event.name, userId };
    },
  );

  return {
    id: "031-wildcard-trigger",
    functions: [UserEvents],
    cases: [
      eventCase({
        events: [{ name: "user.created", data: { userId: "user-031" } }],
        expect: [{ functionId: "examples-031-wildcard-trigger-handle-user-events" }],
      }),
    ],
  };
});
