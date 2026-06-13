import { defineNativeExample, eventCase } from "./_support.ts";

export default defineNativeExample((inngest) => {
  const Idempotent = inngest.createFunction(
    {
      id: "idempotent-handler",
      triggers: [{ event: "demo/idempotent-event" }],
    },
    async ({ event, runId, logger }) => {
      const data = typeof event.data.data === "string" ? event.data.data : "";
      logger.info(`Processing event, runId: ${runId}, data: ${data}`);
      return { processed: true, eventId: runId };
    },
  );

  return {
    id: "035-event-with-id",
    functions: [Idempotent],
    cases: [
      eventCase({
        events: [{ name: "demo/idempotent-event", data: { data: "payload-035" } }],
        expect: [{ functionId: "examples-035-event-with-id-idempotent-handler" }],
      }),
    ],
  };
});
