import { NonRetriableError } from "inngest";
import { defineNativeExample, eventCase } from "./_support.ts";

export default defineNativeExample((inngest) => {
  const FailingChild = inngest.createFunction(
    {
      id: "failing-child",
      triggers: [{ event: "demo/failing-child" }],
    },
    async () => {
      throw new NonRetriableError("Child always fails");
    },
  );

  const ParentInvoker = inngest.createFunction(
    {
      id: "parent-invoker",
      triggers: [{ event: "demo/invoke-failing" }],
    },
    async ({ step }) => {
      try {
        await step.invoke("call-child", { function: FailingChild, data: {} });
        return { status: "success" as const };
      } catch (error) {
        return {
          status: "caught-error" as const,
          error: error instanceof Error ? error.message : "unknown",
        };
      }
    },
  );

  return {
    id: "028-invoke-failure",
    functions: [FailingChild, ParentInvoker],
    cases: [
      eventCase({
        events: [{ name: "demo/invoke-failing", data: {} }],
        expect: [{ functionId: "examples-028-invoke-failure-parent-invoker" }],
      }),
    ],
  };
});
