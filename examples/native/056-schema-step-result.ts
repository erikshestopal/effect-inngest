import { defineNativeExample, eventCase } from "./_support.ts";

export default defineNativeExample((inngest) => {
  const SchemaStepResultFn = inngest.createFunction(
    {
      id: "schema-step-result-demo",
      triggers: [{ event: "examples/056-schema-step-result/demo/schema-step-result" }],
    },
    async ({ step }) => {
      const page = await step.run("load-page", () => ({ url: "https://example.com/docs" }));
      await step.sleep("force-replay", "1s");

      return { pathname: new URL(page.url).pathname };
    },
  );

  return {
    id: "056-schema-step-result",
    functions: [SchemaStepResultFn],
    cases: [
      eventCase({
        events: [{ name: "examples/056-schema-step-result/demo/schema-step-result", data: {} }],
        expect: [{ functionId: "examples-056-schema-step-result-schema-step-result-demo" }],
      }),
    ],
  };
});
