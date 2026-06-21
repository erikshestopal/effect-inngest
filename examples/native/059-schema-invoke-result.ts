import { defineNativeExample, eventCase } from "./_support.ts";

export default defineNativeExample((inngest) => {
  const ChildFn = inngest.createFunction(
    {
      id: "schema-invoke-child",
      triggers: [{ event: "examples/059-schema-invoke-result/demo/child" }],
    },
    async () => ({ url: "https://example.com/invoke" }),
  );

  const ParentFn = inngest.createFunction(
    {
      id: "schema-invoke-parent",
      triggers: [{ event: "examples/059-schema-invoke-result/demo/parent" }],
    },
    async ({ step }) => {
      const page = await step.invoke("call-schema-child", {
        function: ChildFn,
        data: {},
      });

      return { pathname: new URL(page.url).pathname };
    },
  );

  return {
    id: "059-schema-invoke-result",
    functions: [ChildFn, ParentFn],
    cases: [
      eventCase({
        events: [{ name: "examples/059-schema-invoke-result/demo/parent", data: {} }],
        expect: [{ functionId: "examples-059-schema-invoke-result-schema-invoke-parent" }],
      }),
    ],
  };
});
