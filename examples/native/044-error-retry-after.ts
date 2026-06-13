import { RetryAfterError } from "inngest";
import { defineNativeExample, eventCase } from "./_support.ts";

export default defineNativeExample((inngest) => {
  const RetryAfterFn = inngest.createFunction(
    {
      id: "retry-after-demo",
      triggers: [{ event: "demo/retry-after" }],
    },
    async ({ attempt, logger }) => {
      logger.info(`Attempt ${attempt + 1}...`);

      if (attempt < 2) {
        logger.info("Rate limited, scheduling retry in 1 second...");
        throw new RetryAfterError("Rate limited by external API", "1s");
      }

      logger.info("Success on attempt 3!");
      return { attempt: attempt + 1, succeeded: true };
    },
  );

  return {
    id: "044-error-retry-after",
    functions: [RetryAfterFn],
    cases: [
      eventCase({
        events: [{ name: "demo/retry-after", data: {} }],
        expect: [{ functionId: "examples-044-error-retry-after-retry-after-demo" }],
      }),
    ],
  };
});
