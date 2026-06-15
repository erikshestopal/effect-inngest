import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { InngestFunction, InngestGroup, InngestEvent } from "effect-inngest";
import { RetryAfterError } from "effect-inngest";
import { defineExample, eventCase } from "./_support.ts";

const DemoRetryError = InngestEvent.make("demo/retry-error", Schema.Struct({}));

const RetryFn = InngestFunction.make("retry-demo", {
  trigger: { event: DemoRetryError },
  retries: 5,
  success: Schema.Struct({ attempts: Schema.Number }),
});

const Group = InngestGroup.make(RetryFn);

const HandlersLive = Group.toLayer({
  "retry-demo": ({ step, run }) =>
    Effect.gen(function* () {
      const attempt = run.attempt;
      const result = yield* step.run(
        "flaky-step",
        Effect.gen(function* () {
          yield* Effect.log(`Flaky step running, attempt: ${attempt}`);
          if (attempt < 1) {
            yield* Effect.log(`Failing attempt ${attempt}, will retry in 1s`);
            return yield* Effect.fail(
              new RetryAfterError({
                message: `Attempt ${attempt} failed`,
                retryAfter: Duration.seconds(1),
              }),
            );
          }
          yield* Effect.log(`Success on attempt ${attempt}`);
          return attempt + 1;
        }),
      );
      return { attempts: result };
    }),
});

export default defineExample({
  id: "029-retry-error",
  group: Group,
  handlers: HandlersLive,
  cases: [
    eventCase({
      events: [
        {
          name: "demo/retry-error",
          data: {},
        },
      ],
      expect: [
        {
          spans: ["flaky-step"],
          functionTag: "retry-demo",
        },
      ],
      timeoutMs: 30000,
    }),
  ],
});
