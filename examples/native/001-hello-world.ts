import { defineNativeExample, eventCase } from "./_support.ts";

export default defineNativeExample((inngest) => {
  const HelloWorld = inngest.createFunction(
    {
      id: "hello-world",
      triggers: [{ event: "examples/001-hello-world/demo/hello" }, { event: "examples/001-hello-world/demo/bye" }],
    },
    async ({ event, logger }) => {
      const name = typeof event.name === "string" ? event.data.name : "Guest";
      logger.info(`hello-world greeting ${name}`);
      return { greeting: `Hello, ${name}!` };
    },
  );

  return {
    id: "001-hello-world",
    functions: [HelloWorld],
    cases: [
      eventCase({
        events: [{ name: "examples/001-hello-world/demo/hello", data: { name: "Amp" } }],
        expect: [{ functionId: "examples-001-hello-world-hello-world" }],
      }),
    ],
  };
});
