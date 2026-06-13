import { RetryAfterError } from "inngest";
import { defineNativeExample, eventCase } from "./_support.ts";

export default defineNativeExample((inngest) => {
  const RetryDemo = inngest.createFunction(
    {
      id: "retry-demo",
      retries: 5,
      triggers: [{ event: "demo/retry-error" }],
    },
    async ({ step, attempt, logger }) => {
      const result = await step.run("flaky-step", () => {
        logger.info(`Flaky step running, attempt: ${attempt}`);
        if (attempt < 1) {
          logger.info(`Failing attempt ${attempt}, will retry in 1s`);
          throw new RetryAfterError(`Attempt ${attempt} failed`, "1s");
        }
        logger.info(`Success on attempt ${attempt}`);
        return attempt + 1;
      });
      return { attempts: result };
    },
  );

  return {
    id: "029-retry-error",
    functions: [RetryDemo],
    cases: [
      eventCase({
        events: [{ name: "demo/retry-error", data: {} }],
        expect: [{ functionId: "examples-029-retry-error-retry-demo" }],
      }),
    ],
  };
});
