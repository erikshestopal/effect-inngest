import { NonRetriableError } from "inngest";
import { defineNativeExample, eventCase } from "./_support.ts";

export default defineNativeExample((inngest) => {
  const NonRetriableFn = inngest.createFunction(
    {
      id: "non-retriable",
      triggers: [{ event: "demo/non-retriable" }],
    },
    async ({ step }) => {
      await step.run("fail", () => {
        throw new NonRetriableError("No retry");
      });
      return { success: true };
    },
  );

  return {
    id: "012-error-non-retriable",
    functions: [NonRetriableFn],
    cases: [
      eventCase({
        events: [{ name: "demo/non-retriable", data: {} }],
        expect: [{ functionId: "examples-012-error-non-retriable-non-retriable" }],
      }),
    ],
  };
});
