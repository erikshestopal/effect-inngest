import { defineNativeExample, eventCase } from "./_support.ts";

export default defineNativeExample((inngest) => {
  const ChildFn = inngest.createFunction(
    {
      id: "child-square",
      triggers: [{ event: "demo/invoke-child" }, { event: "demo/invoke-child-2" }],
    },
    async ({ event }) => {
      const squared =
        typeof event.data.value === "number"
          ? event.data.value * event.data.value
          : typeof event.data.test === "string"
            ? event.data.test.length
            : 0;
      return { squared };
    },
  );

  const ParentFn = inngest.createFunction(
    {
      id: "parent-invoke",
      triggers: [{ event: "demo/invoke-parent" }],
    },
    async ({ event, step }) => {
      const number = typeof event.data.number === "number" ? event.data.number : 0;
      const childResult = await step.invoke("call-child", {
        function: ChildFn,
        data: { value: number },
      });
      return { result: childResult.squared };
    },
  );

  return {
    id: "011-step-invoke",
    functions: [ChildFn, ParentFn],
    cases: [
      eventCase({
        events: [{ name: "demo/invoke-parent", data: { number: 7 } }],
        expect: [{ functionId: "examples-011-step-invoke-parent-invoke" }],
      }),
    ],
  };
});
