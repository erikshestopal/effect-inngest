import { defineNativeExample, eventCase } from "./_support.ts";

export default defineNativeExample((inngest) => {
  const SchemaWorkflowResultFn = inngest.createFunction(
    {
      id: "schema-workflow-result-demo",
      triggers: [{ event: "examples/057-schema-workflow-result/demo/schema-workflow-result" }],
    },
    async ({ step }) => {
      await step.sleep("force-replay", "1s");
      return { url: "https://example.com/workflow" };
    },
  );

  return {
    id: "057-schema-workflow-result",
    functions: [SchemaWorkflowResultFn],
    cases: [
      eventCase({
        events: [{ name: "examples/057-schema-workflow-result/demo/schema-workflow-result", data: {} }],
        expect: [{ functionId: "examples-057-schema-workflow-result-schema-workflow-result-demo" }],
      }),
    ],
  };
});
