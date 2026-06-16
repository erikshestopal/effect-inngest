import { defineNativeExample, eventCase } from "./_support.ts";

export default defineNativeExample((inngest) => {
  const Helper = inngest.createFunction(
    {
      id: "helper-function",
      triggers: [{ event: "examples/034-reference-function/demo/helper-event" }],
    },
    async ({ event }) => {
      const input = typeof event.data.input === "number" ? event.data.input : 0;
      return { doubled: input * 2 };
    },
  );

  const Invoker = inngest.createFunction(
    {
      id: "invoke-by-reference",
      triggers: [{ event: "examples/034-reference-function/demo/reference-invoke" }],
    },
    async ({ step }) => {
      const helperResult = await step.invoke("call-helper", {
        function: Helper,
        data: { input: 21 },
      });
      return { result: helperResult.doubled };
    },
  );

  return {
    id: "034-reference-function",
    functions: [Helper, Invoker],
    cases: [
      eventCase({
        events: [{ name: "examples/034-reference-function/demo/reference-invoke", data: {} }],
        expect: [{ functionId: "examples-034-reference-function-invoke-by-reference" }],
      }),
    ],
  };
});
