import { defineNativeExample, eventCase } from "./_support.ts";

export default defineNativeExample((inngest) => {
  const SchemaWaitForEventFn = inngest.createFunction(
    {
      id: "schema-waitForEvent-demo",
      triggers: [{ event: "examples/058-schema-waitForEvent/demo/wait-start" }],
    },
    async ({ step }) => {
      const page = await step.waitForEvent("wait-for-page", {
        event: "examples/058-schema-waitForEvent/demo/page-ready",
        timeout: "5m",
      });

      return { pathname: page ? new URL(String(page.data.url)).pathname : null };
    },
  );

  return {
    id: "058-schema-waitForEvent",
    functions: [SchemaWaitForEventFn],
    cases: [
      eventCase({
        events: [{ name: "examples/058-schema-waitForEvent/demo/wait-start", data: {} }],
        afterEvents: [
          {
            delayMs: 1000,
            events: [
              { name: "examples/058-schema-waitForEvent/demo/page-ready", data: { url: "https://example.com/wait" } },
            ],
          },
        ],
        expect: [{ functionId: "examples-058-schema-waitForEvent-schema-waitForEvent-demo" }],
      }),
    ],
  };
});
