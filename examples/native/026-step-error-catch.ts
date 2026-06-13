import { defineNativeExample, eventCase } from "./_support.ts";

export default defineNativeExample((inngest) => {
  const StepCatch = inngest.createFunction(
    {
      id: "step-catch-handler",
      triggers: [{ event: "demo/step-catch" }],
    },
    async ({ step }) => {
      const result = await step
        .run("risky-step", (): string => {
          throw new Error("Something went wrong");
        })
        .catch((error) => `Caught error: ${error instanceof Error ? error.message : "unknown"}`);
      return { result };
    },
  );

  return {
    id: "026-step-error-catch",
    functions: [StepCatch],
    cases: [
      eventCase({
        events: [{ name: "demo/step-catch", data: {} }],
        expect: [{ functionId: "examples-026-step-error-catch-step-catch-handler" }],
      }),
    ],
  };
});
