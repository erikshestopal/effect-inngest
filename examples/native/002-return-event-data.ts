import { defineNativeExample, eventCase } from "./_support.ts";

export default defineNativeExample((inngest) => {
  const EchoFn = inngest.createFunction(
    {
      id: "echo-data",
      triggers: [{ event: "examples/002-return-event-data/demo/echo" }],
    },
    async ({ event, logger }) => {
      const message = typeof event.data.message === "string" ? event.data.message : "";
      logger.info(`echo-data received: ${message}`);
      return { received: message };
    },
  );

  return {
    id: "002-return-event-data",
    functions: [EchoFn],
    cases: [
      eventCase({
        events: [
          { name: "examples/002-return-event-data/demo/echo", data: { message: "hello from examples harness" } },
        ],
        expect: [{ functionId: "examples-002-return-event-data-echo-data" }],
      }),
    ],
  };
});
