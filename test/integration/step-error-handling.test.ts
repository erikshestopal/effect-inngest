import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { describe, expect, it } from "@effect/vitest";
import { InngestFunction, InngestGroup } from "../../src/index.js";
import * as Protocol from "../../src/internal/protocol.js";
import { failWith, makeTestLayer, makeTestRequest } from "./_helpers.js";
import { StepErrorResponse } from "./_schemas.js";

class TestErrorStep extends Schema.TaggedClass<TestErrorStep>()("test/error-step", {
  shouldFail: Schema.Boolean,
}) {}

describe("TB-010: Step Error Handling", () => {
  const FailingStepFn = InngestFunction.make("failing-step-fn", {
    trigger: { event: TestErrorStep },
    success: Schema.Struct({ result: Schema.String }),
  });

  const Group = InngestGroup.make(FailingStepFn);

  // Custom request builder with step_id control
  // NOTE: We use plain JSON instead of Protocol.SDKRequestBody.make() because
  // .make() strips nested union fields (like steps[hash].error) during validation
  const makeRequestWithStepId = (
    steps: Record<string, { data?: unknown; error?: { name: string; message: string; stack?: string } }> = {},
    stepId = "step",
  ) => {
    return new Request(`http://localhost/?fnId=failing-step-fn`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        event: {
          name: "test/error-step",
          data: { shouldFail: true },
          id: "evt_1",
          ts: Date.now(),
        },
        events: [],
        steps,
        ctx: {
          fn_id: "failing-step-fn",
          run_id: "run_123",
          env: "test",
          step_id: stepId,
          attempt: 0,
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

  describe("TB-010.1 Memoized Step Error", () => {
    it.effect("re-raises error when memoized data has error property", () =>
      Effect.gen(function* () {
        const HandlersLive = Group.toLayer({
          "failing-step-fn": ({ step }) =>
            Effect.gen(function* () {
              // This step will receive memoized error
              yield* step.run("will-fail", Effect.succeed("ok"));
              return { result: "done" };
            }),
        });

        const { handler, dispose } = InngestGroup.toWebHandler(Group, { layer: makeTestLayer(HandlersLive) });

        try {
          // SHA-1("will-fail") - the hash of the step id
          const stepHash = "7111f00a7972ee1bcbc5e3febe576bb2d87d8104";

          // Memoized step with error result - this causes StepError to be thrown
          // which propagates as a failure and results in 500
          const response = yield* Effect.tryPromise(() =>
            handler(
              makeRequestWithStepId({
                [stepHash]: {
                  // Use plain object - Schema.Class instances may not serialize correctly via JSON.stringify
                  error: { name: "PreviousError", message: "Previously failed", stack: undefined },
                },
              }),
            ),
          );

          // Spec §5.2.2: "If an error ... and the Developer has not either
          // swallowed the error or returned/thrown/raised a new error, the
          // SDK MUST mark the request as non-retriable." → 400 + NoRetry:true
          expect(response.status).toBe(400);
          expect(response.headers.get(Protocol.Headers.NoRetry)).toBe("true");

          const body = (yield* Effect.tryPromise(() => response.json())) as {
            name: string;
            message: string;
            stack?: string;
          };
          expect(body.name).toBe("StepError");
          expect(body.message).toBe("Previously failed");
          // Stack is present (generated from the StepError creation point)
          expect(body.stack).toBeDefined();
        } finally {
          yield* Effect.tryPromise(() => dispose());
        }
      }),
    );
  });

  describe("TB-010.2 Step Failure emits StepError", () => {
    it.effect("emits StepError opcode when step.run fails", () =>
      Effect.gen(function* () {
        const HandlersLive = Group.toLayer({
          "failing-step-fn": ({ step }) =>
            Effect.gen(function* () {
              // This step fails intentionally - use failWith helper to avoid lint warning
              const result = yield* step.run("will-fail", failWith(new Error("Intentional failure")));
              return { result };
            }),
        });

        const { handler, dispose } = InngestGroup.toWebHandler(Group, { layer: makeTestLayer(HandlersLive) });

        try {
          // Use step_id="step" to trigger first-call execution
          const response = yield* Effect.tryPromise(() => handler(makeRequestWithStepId({})));

          expect(response.status).toBe(206);

          const body = yield* Effect.tryPromise(() => response.json()).pipe(
            Effect.flatMap(Schema.decodeUnknownEffect(StepErrorResponse)),
          );

          expect(body).toHaveLength(1);
          const opcode = body[0]!;

          expect(opcode.op).toBe(Protocol.Opcode.StepError);
          expect(opcode.name).toBe("will-fail");
          expect(opcode.error.name).toBe("Error");
          expect(opcode.error.message).toBe("Intentional failure");

          expect(body).toMatchInlineSnapshot(`
            [
              {
                "displayName": "will-fail",
                "error": {
                  "message": "Intentional failure",
                  "name": "Error",
                },
                "id": "7111f00a7972ee1bcbc5e3febe576bb2d87d8104",
                "name": "will-fail",
                "op": "StepError",
              },
            ]
          `);
        } finally {
          yield* Effect.tryPromise(() => dispose());
        }
      }),
    );

    it.effect("includes error stack in StepError opcode", () =>
      Effect.gen(function* () {
        const HandlersLive = Group.toLayer({
          "failing-step-fn": ({ step }) =>
            Effect.gen(function* () {
              const customError = new Error("Error with stack");
              const result = yield* step.run("step-with-stack", failWith(customError));
              return { result };
            }),
        });

        const { handler, dispose } = InngestGroup.toWebHandler(Group, { layer: makeTestLayer(HandlersLive) });

        try {
          const response = yield* Effect.tryPromise(() => handler(makeRequestWithStepId({})));

          expect(response.status).toBe(206);

          const body = yield* Effect.tryPromise(() => response.json());
          const opcodes = body as ReadonlyArray<{ error: { stack?: string } }>;
          const opcode = opcodes[0]!;

          // Stack should be present
          expect(opcode.error.stack).toBeDefined();
          expect(opcode.error.stack).toContain("Error with stack");
        } finally {
          yield* Effect.tryPromise(() => dispose());
        }
      }),
    );
  });

  describe("TB-010.3 Invoke Memoized Error", () => {
    class TestInvoke extends Schema.TaggedClass<TestInvoke>()("test/invoke", {
      targetId: Schema.String,
    }) {}

    class TestTarget extends Schema.TaggedClass<TestTarget>()("test/target", {
      value: Schema.Number,
    }) {}

    const TargetFn = InngestFunction.make("target-fn", {
      trigger: { event: TestTarget },
      success: Schema.Unknown,
    });

    const InvokerFn = InngestFunction.make("invoker-fn", {
      trigger: { event: TestInvoke },
      success: Schema.Unknown,
    });

    const InvokeGroup = InngestGroup.make(TargetFn, InvokerFn);

    it.effect("propagates error when invoked function result has error", () =>
      Effect.gen(function* () {
        const HandlersLive = InvokeGroup.toLayer({
          "target-fn": () => Effect.succeed({ computed: 42 }),
          "invoker-fn": ({ event, step }) =>
            Effect.gen(function* () {
              const result = yield* step.invoke("call-target", {
                function: TargetFn,
                data: TestTarget.make({ value: 100 }),
              });
              return { targetId: event.targetId, result };
            }),
        });

        const { handler, dispose } = InngestGroup.toWebHandler(InvokeGroup, {
          layer: makeTestLayer(HandlersLive),
        });

        try {
          // SHA-1("call-target") - the hash of the step id
          const stepHash = "762e7c3a94432f2a60cda87ddafef1a69678d752";

          // Simulate memoized invoke result with error (target function failed)
          const request = new Request(`http://localhost/?fnId=invoker-fn`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(
              Protocol.SDKRequestBody.make({
                event: Protocol.InngestEvent.make({
                  name: "test/invoke",
                  data: { targetId: "target-123" },
                  id: "evt_1",
                  ts: Date.now(),
                }),
                events: [],
                steps: {
                  [stepHash]: {
                    error: Protocol.UserError.make({
                      name: "TargetFunctionError",
                      message: "Target function failed",
                      stack: undefined,
                    }),
                  },
                },
                ctx: Protocol.SDKRequestContext.make({
                  fn_id: "invoker-fn",
                  run_id: "run_123",
                  env: "test",
                  step_id: "step",
                  attempt: 0,
                  max_attempts: 4,
                  stack: Protocol.FunctionStack.make({ stack: [], current: 0 }),
                  qi_id: "qi_123",
                  disable_immediate_execution: false,
                  use_api: false,
                }),
                version: 1,
                use_api: false,
              }),
            ),
          });

          const response = yield* Effect.tryPromise(() => handler(request));

          // Memoized invoke error causes StepError which propagates as 500
          expect(response.status).toBe(500);

          const body = (yield* Effect.tryPromise(() => response.json())) as {
            name: string;
            message: string;
            stack?: string;
          };
          expect(body.name).toBe("StepError");
          expect(body.message).toBe("Target function failed");
          // Stack is present (generated from the StepError creation point)
          expect(body.stack).toBeDefined();
        } finally {
          yield* Effect.tryPromise(() => dispose());
        }
      }),
    );
  });

  describe("TB-010.4 Defect Handling", () => {
    it.effect("catches unexpected defects and returns 500", () =>
      Effect.gen(function* () {
        const HandlersLive = Group.toLayer({
          "failing-step-fn": () =>
            // Simulate a defect (bug) - Effect.die creates a defect that bypasses the error channel
            // Testing defect handling intentionally - global Error is needed to test catchAllDefect
            // eslint-disable-next-line effect-inngest/no-global-error-in-effect-fail
            Effect.die(new Error("Unexpected bug in handler")),
        });

        const { handler, dispose } = InngestGroup.toWebHandler(Group, { layer: makeTestLayer(HandlersLive) });

        try {
          const response = yield* Effect.tryPromise(() => handler(makeRequestWithStepId({})));

          // Defects are caught by catchAllDefect and return 500
          expect(response.status).toBe(500);

          const body = (yield* Effect.tryPromise(() => response.json())) as {
            message: string;
          };
          expect(body.message).toBe("Unexpected bug in handler");
        } finally {
          yield* Effect.tryPromise(() => dispose());
        }
      }),
    );

    it.effect("preserves defect information for debugging", () =>
      Effect.gen(function* () {
        const HandlersLive = Group.toLayer({
          // Simulate a synchronous defect via Effect.die with TypeError
          "failing-step-fn": () => Effect.die(new TypeError("Cannot read property 'x' of undefined")),
        });

        const { handler, dispose } = InngestGroup.toWebHandler(Group, { layer: makeTestLayer(HandlersLive) });

        try {
          const response = yield* Effect.tryPromise(() => handler(makeRequestWithStepId({})));

          expect(response.status).toBe(500);

          const body = (yield* Effect.tryPromise(() => response.json())) as {
            name: string;
            message: string;
          };
          // TypeError should be captured
          expect(body.name).toBe("TypeError");
          expect(body.message).toBe("Cannot read property 'x' of undefined");
        } finally {
          yield* Effect.tryPromise(() => dispose());
        }
      }),
    );

    it.effect("catches sync thrown error in step.run and emits StepError opcode", () =>
      Effect.gen(function* () {
        const HandlersLive = Group.toLayer({
          "failing-step-fn": ({ step }) =>
            Effect.gen(function* () {
              return yield* step.run(
                "sync-throw-step",
                Effect.sync(() => {
                  throw new RangeError("Sync thrown in step.run");
                }),
              );
            }),
        });

        const { handler, dispose } = InngestGroup.toWebHandler(Group, { layer: makeTestLayer(HandlersLive) });

        try {
          const response = yield* Effect.tryPromise(() => handler(makeRequestWithStepId({})));

          expect(response.status).toBe(206);

          const body = yield* Effect.tryPromise(() => response.json()).pipe(
            Effect.flatMap(Schema.decodeUnknownEffect(StepErrorResponse)),
          );

          expect(body).toHaveLength(1);
          const opcode = body[0]!;

          expect(opcode.op).toBe(Protocol.Opcode.StepError);
          expect(opcode.name).toBe("sync-throw-step");
          expect(opcode.error.name).toBe("RangeError");
          expect(opcode.error.message).toBe("Sync thrown in step.run");
        } finally {
          yield* Effect.tryPromise(() => dispose());
        }
      }),
    );

    it.effect("handles non-Error defects in step.run by converting to string", () =>
      Effect.gen(function* () {
        const HandlersLive = Group.toLayer({
          "failing-step-fn": ({ step }) =>
            Effect.gen(function* () {
              return yield* step.run(
                "non-error-defect",
                Effect.sync(() => {
                  throw "string error thrown";
                }),
              );
            }),
        });

        const { handler, dispose } = InngestGroup.toWebHandler(Group, { layer: makeTestLayer(HandlersLive) });

        try {
          const response = yield* Effect.tryPromise(() => handler(makeRequestWithStepId({})));

          expect(response.status).toBe(206);

          const body = yield* Effect.tryPromise(() => response.json()).pipe(
            Effect.flatMap(Schema.decodeUnknownEffect(StepErrorResponse)),
          );

          expect(body).toHaveLength(1);
          const opcode = body[0]!;

          expect(opcode.op).toBe(Protocol.Opcode.StepError);
          expect(opcode.error.name).toBe("Error");
          expect(opcode.error.message).toBe("string error thrown");
        } finally {
          yield* Effect.tryPromise(() => dispose());
        }
      }),
    );
  });

  describe("TB-010.5 FunctionGroup Access", () => {
    it("functions map contains all functions", () => {
      expect(Group.functions.size).toBe(1);
      expect(Group.functions.has("failing-step-fn")).toBe(true);
    });

    it("functions map contains all functions in multi-function group", () => {
      class TestA extends Schema.TaggedClass<TestA>()("test/a", {
        valueA: Schema.String,
      }) {}

      class TestB extends Schema.TaggedClass<TestB>()("test/b", {
        valueB: Schema.Number,
      }) {}

      const FnA = InngestFunction.make("fn-a", {
        trigger: { event: TestA },
        success: Schema.Unknown,
      });

      const FnB = InngestFunction.make("fn-b", {
        trigger: { event: TestB },
        success: Schema.Unknown,
      });

      const MultiGroup = InngestGroup.make(FnA, FnB);

      expect(MultiGroup.functions.size).toBe(2);
      expect(MultiGroup.functions.has("fn-a")).toBe(true);
      expect(MultiGroup.functions.has("fn-b")).toBe(true);
    });
  });
});
