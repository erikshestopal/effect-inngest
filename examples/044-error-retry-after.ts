import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { InngestFunction, InngestGroup, InngestEvent } from "effect-inngest";
import { RetryAfterError } from "effect-inngest";
import { defineExample, eventCase } from "./_support.ts";

const DemoRetryAfter = InngestEvent.make("examples/044-error-retry-after/demo/retry-after", Schema.Struct({}));

const RetryAfterFn = InngestFunction.make("retry-after-demo", {
  trigger: { event: DemoRetryAfter },
  success: Schema.Struct({ attempt: Schema.Number, succeeded: Schema.Boolean }),
});

const Group = InngestGroup.make(RetryAfterFn);

let attemptCount = 0;

const HandlersLive = Group.toLayer({
  "retry-after-demo": () =>
    Effect.gen(function* () {
      attemptCount++;
      yield* Effect.log(`Attempt ${attemptCount}...`);

      if (attemptCount < 3) {
        yield* Effect.log(`Rate limited, scheduling retry in 30 seconds...`);
        return yield* Effect.fail(
          new RetryAfterError({
            message: "Rate limited by external API",
            retryAfter: Duration.seconds(1),
          }),
        );
      }

      yield* Effect.log("Success on attempt 3!");
      return { attempt: attemptCount, succeeded: true };
    }),
});

export default defineExample({
  id: "044-error-retry-after",
  group: Group,
  handlers: HandlersLive,
  cases: [
    eventCase({
      events: [
        {
          name: "examples/044-error-retry-after/demo/retry-after",
          data: {},
        },
      ],
      expect: [
        {
          functionTag: "retry-after-demo",
        },
      ],
      timeoutMs: 30000,
    }),
  ],
});
