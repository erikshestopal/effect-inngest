import { defineNativeExample, eventCase } from "./_support.ts";

const emailService = {
  send: (to: string, subject: string, body: string) => {
    console.log(`[EMAIL] To: ${to}, Subject: ${subject}, Body: ${body}`);
  },
};

export default defineNativeExample((inngest) => {
  const ServiceHandler = inngest.createFunction(
    {
      id: "service-handler",
      triggers: [{ event: "examples/030-context-services/demo/with-services" }],
    },
    async ({ event }) => {
      const name = typeof event.name === "string" ? event.data.name : "Guest";
      emailService.send("user@example.com", "Welcome!", `Hello ${name}, welcome to our service!`);
      return { sent: true };
    },
  );

  return {
    id: "030-context-services",
    functions: [ServiceHandler],
    cases: [
      eventCase({
        events: [{ name: "examples/030-context-services/demo/with-services", data: { name: "Ada" } }],
        expect: [{ functionId: "examples-030-context-services-service-handler" }],
      }),
    ],
  };
});
