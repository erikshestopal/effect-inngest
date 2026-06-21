import { defineNativeExample, eventCase } from "./_support.ts";

export default defineNativeExample((inngest) => {
  const SchemaSendEventFn = inngest.createFunction(
    {
      id: "schema-sendEvent-demo",
      triggers: [{ event: "examples/066-schema-sendEvent/demo/start" }],
    },
    async ({ step }) => {
      await step.sendEvent("send-schema-event", {
        name: "examples/066-schema-sendEvent/demo/notification",
        data: { url: "https://example.com/send-event" },
      });

      return { sent: true };
    },
  );

  return {
    id: "066-schema-sendEvent",
    functions: [SchemaSendEventFn],
    cases: [
      eventCase({
        events: [{ name: "examples/066-schema-sendEvent/demo/start", data: {} }],
        expect: [{ functionId: "examples-066-schema-sendEvent-schema-sendEvent-demo" }],
      }),
    ],
  };
});
