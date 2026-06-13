import { defineNativeExample, eventCase } from "./_support.ts";

export default defineNativeExample((inngest) => {
  const HelloWorld = inngest.createFunction(
    {
      id: "hello-world",
      triggers: [{ event: "demo/hello" }],
    },
    async ({ event }) => {
      const name = typeof event.data.name === "string" ? event.data.name : "Guest";
      return { greeting: `Hello, ${name}!` };
    },
  );

  return {
    id: "101-httpapi-hello-world",
    functions: [HelloWorld],
    cases: [
      eventCase({
        events: [{ name: "demo/hello", data: { name: "Amp" } }],
        expect: [{ functionId: "examples-101-httpapi-hello-world-hello-world" }],
      }),
    ],
  };
});
