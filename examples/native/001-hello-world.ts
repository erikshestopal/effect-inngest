import { defineNativeExample, eventCase } from "./_support.ts";

export default defineNativeExample((inngest) => {
  const HelloWorld = inngest.createFunction(
    {
      id: "hello-world",
      triggers: [{ event: "demo/hello" }, { event: "demo/bye" }],
    },
    async ({ event, logger }) => {
      const name = typeof event.data.name === "string" ? event.data.name : "Guest";
      logger.info(`hello-world greeting ${name}`);
      return { greeting: `Hello, ${name}!` };
    },
  );

  return {
    id: "001-hello-world",
    functions: [HelloWorld],
    cases: [
      eventCase({
        events: [{ name: "demo/hello", data: { name: "Amp" } }],
        expect: [{ functionId: "examples-001-hello-world-hello-world" }],
      }),
    ],
  };
});
