import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { describe, expect, it } from "../bun-effect.js";
import { RetryAfterError } from "../../src/index.js";
import { InngestFunction, InngestGroup } from "../../src/index.js";
import * as Protocol from "../../src/internal/protocol.js";
import { failWith, makeTestLayer } from "./_helpers.js";
import { StepErrorResponse } from "./_schemas.js";

class TestRetryAfter extends Schema.TaggedClass<TestRetryAfter>()("test/retry-after", {
  value: Schema.Number,
}) {}

describe("RetryAfterError Behavior", () => {
  const RetryAfterFn = InngestFunction.make("retry-after-fn", {
    trigger: { event: TestRetryAfter },
    success: Schema.Struct({ result: Schema.String }),
  });

  const Group = InngestGroup.make(RetryAfterFn);

  // Request builder that allows controlling step_id and attempt
  const makeRequestWithContext = (
    steps: Record<string, { data?: unknown; error?: { name: string; message: string } }> = {},
    stepId = "step",
    attempt = 0,
  ) => {
    return new Request(`http://localhost/?fnId=retry-after-fn`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        event: {
          name: "test/retry-after",
          data: { value: 1 },
          id: "evt_1",
          ts: Date.now(),
        },
        events: [],
        steps,
        ctx: {
          fn_id: "retry-after-fn",
          run_id: "run_123",
          env: "test",
          step_id: stepId,
          attempt,
          max_attempts: 4,
          stack: { stack: [], current: 0 },
          qi_id: "qi_123",
          disable_immediate_execution: false,
          use_api: false,
        },
        version: 1,
        use_api: false,
      }),
    });
  };

  describe("RetryAfterError inside step.run", () => {
    it.effect("emits StepError opcode (206) - NOT function-level retry", () =>
      Effect.gen(function* () {
        const HandlersLive = Group.toLayer({
          "retry-after-fn": ({ step }) =>
            Effect.gen(function* () {
              const result = yield* step.run(
                "retry-step",
                failWith(
                  RetryAfterError.make({
                    message: "Rate limited, retry in 5s",
                    retryAfter: Duration.seconds(5),
                  }),
                ),
              );
              return { result };
            }),
        });

        const { handler, dispose } = InngestGroup.toWebHandler(Group, { layer: makeTestLayer(HandlersLive) });

        try {
          const response = yield* Effect.tryPromise(() => handler(makeRequestWithContext({})));

          // Should be 206 with StepError opcode
          // RetryAfterError inside step.run sets Retry-After header on 206 response
          expect(response.status).toBe(206);

          const body = yield* Effect.tryPromise(() => response.json()).pipe(
            Effect.flatMap(Schema.decodeUnknownEffect(StepErrorResponse)),
          );

          expect(body).toHaveLength(1);
          const opcode = body[0]!;

          expect(opcode.op).toBe(Protocol.Opcode.StepError);
          expect(opcode.name).toBe("retry-step");
          expect(opcode.error.name).toBe("RetryAfterError");
          expect(opcode.error.message).toBe("Rate limited, retry in 5s");

          // Verify Retry-After header is set with custom timing (5 seconds)
          expect(response.headers.get(Protocol.Headers.RetryAfter)).toBe("5");
        } finally {
          yield* Effect.tryPromise(() => dispose());
        }
      }),
    );

    it.effect("step succeeds on retry when memoized with success data", () =>
      Effect.gen(function* () {
        const HandlersLive = Group.toLayer({
          "retry-after-fn": ({ step }) =>
            Effect.gen(function* () {
              const result = yield* step.run(
                "retry-step",
                failWith(
                  RetryAfterError.make({
                    message: "Should not reach here - memoized",
                    retryAfter: Duration.seconds(5),
                  }),
                ),
              );
              return { result };
            }),
        });

        const { handler, dispose } = InngestGroup.toWebHandler(Group, { layer: makeTestLayer(HandlersLive) });

        try {
          // SHA-1("retry-step") hash
          const stepHash = "30d540638581ae4737f414e5a431d53474bd332b";

          // Simulate memoized success from previous retry
          const response = yield* Effect.tryPromise(() =>
            handler(
              makeRequestWithContext(
                {
                  [stepHash]: { data: "success from retry" },
                },
                "step",
                1, // attempt 1 (second attempt)
              ),
            ),
          );

          // Function should complete successfully with memoized data
          expect(response.status).toBe(200);

          const body = yield* Effect.tryPromise(() => response.json());
          expect(body).toEqual({ result: "success from retry" });
        } finally {
          yield* Effect.tryPromise(() => dispose());
        }
      }),
    );
  });

  describe("RetryAfterError at function level (outside steps)", () => {
    it.effect("returns 500 with Retry-After header for function-level retry", () =>
      Effect.gen(function* () {
        const HandlersLive = Group.toLayer({
          "retry-after-fn": () =>
            // Throw RetryAfterError directly at function level (no step)
            Effect.fail(
              RetryAfterError.make({
                message: "Function rate limited",
                retryAfter: Duration.seconds(30),
              }),
            ),
        });

        const { handler, dispose } = InngestGroup.toWebHandler(Group, { layer: makeTestLayer(HandlersLive) });

        try {
          const response = yield* Effect.tryPromise(() => handler(makeRequestWithContext({})));

          // Should be 500 with Retry-After header
          expect(response.status).toBe(500);

          // Check Retry-After header is set (in seconds)
          const retryAfter = response.headers.get(Protocol.Headers.RetryAfter);
          expect(retryAfter).toBe("30");

          // Check X-Inngest-No-Retry is false (should retry)
          expect(response.headers.get(Protocol.Headers.NoRetry)).toBe("false");

          const body = (yield* Effect.tryPromise(() => response.json())) as {
            error: { name: string; message: string };
          };
          expect(body.error.name).toBe("RetryAfterError");
          expect(body.error.message).toBe("Function rate limited");
        } finally {
          yield* Effect.tryPromise(() => dispose());
        }
      }),
    );
  });
});
