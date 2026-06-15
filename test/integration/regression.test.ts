/**
 * Regression tests for bugs fixed during development.
 *
 * Each test documents a specific bug that was found and fixed,
 * ensuring we don't regress on these issues.
 */
import { describe, expect, it } from "@effect/vitest";
import { Duration, Effect, Option, Schema } from "effect";
import { InngestFunction, InngestGroup } from "../../src/index.js";
import * as Protocol from "../../src/internal/protocol.js";
import { NonRetriableError } from "../../src/index.js";
import { makeTestLayer, makeTestRequest } from "./_helpers.js";

describe("Regression: Opcode values are strings (not numbers)", () => {
  /**
   * Bug: Opcode values were numeric (0-14) but Inngest executor expects strings.
   * Error: "Opcode should be a string, got 2"
   * Fix: Changed Opcode values to strings like "StepRun", "StepPlanned", etc.
   */
  it("Opcode.StepRun is a string", () => {
    expect(typeof Protocol.Opcode.StepRun).toBe("string");
    expect(Protocol.Opcode.StepRun).toBe("StepRun");
  });

  it("Opcode.StepPlanned is a string", () => {
    expect(typeof Protocol.Opcode.StepPlanned).toBe("string");
    expect(Protocol.Opcode.StepPlanned).toBe("StepPlanned");
  });

  it("Opcode.Sleep is a string", () => {
    expect(typeof Protocol.Opcode.Sleep).toBe("string");
    expect(Protocol.Opcode.Sleep).toBe("Sleep");
  });

  it("all opcodes are strings with matching key names", () => {
    const opcodes = Object.entries(Protocol.Opcode) as Array<[string, string]>;
    expect(opcodes.length).toBeGreaterThan(0);
    for (const [key, value] of opcodes) {
      expect(typeof value).toBe("string");
      expect(value).toEqual(key);
    }
  });
});

describe("Regression: StepResult accepts null (sleep results)", () => {
  /**
   * Bug: Sleep steps return null as their result, but StepResult schema
   * only accepted { data }, { error }, or { input }.
   * Error: "Expected { readonly data: unknown }, actual null"
   * Fix: Added Schema.Null to StepResult union.
   */
  it.effect("StepResult schema accepts null", () =>
    Effect.gen(function* () {
      const result = yield* Schema.decodeUnknownEffect(Protocol.StepResult)(null);
      expect(result).toBe(null);
    }),
  );

  it.effect("StepResult schema still accepts data objects", () =>
    Effect.gen(function* () {
      const result = yield* Schema.decodeUnknownEffect(Protocol.StepResult)({ data: "hello" });
      expect(result).toEqual({ data: "hello" });
    }),
  );

  it.effect("SDKRequestBody accepts steps with null values", () =>
    Effect.gen(function* () {
      const request = makeTestRequest({
        fnId: "test-fn",
        eventName: "test/event",
        eventData: { foo: "bar" },
        steps: {
          "step-hash-1": { data: "some data" },
          "step-hash-2": null, // Sleep step result
        },
      });

      const rawBody = yield* Effect.tryPromise(() => request.text().then(JSON.parse));
      const body = yield* Schema.decodeUnknownEffect(Protocol.SDKRequestBody)(rawBody);

      expect(body.steps["step-hash-1"]).toEqual({ data: "some data" });
      expect(body.steps["step-hash-2"]).toBe(null);
    }),
  );
});

class TestParallelSleep extends Schema.TaggedClass<TestParallelSleep>()("test/parallel-sleep", {
  taskId: Schema.String,
}) {}

describe("Regression: Memoization handles null values (sleep in parallel)", () => {
  /**
   * Bug: checkMemoized used Option.fromNullable which returns None for null.
   * This caused sleep steps in parallel execution to be treated as "not memoized"
   * even when their results were present (as null).
   * Error: Function was CANCELLED after sleep completed in parallel.
   * Fix: Changed checkMemoized to use `in` operator to check key existence.
   */
  const ParallelSleepFn = InngestFunction.make("parallel-sleep", {
    trigger: { event: TestParallelSleep },
    success: Schema.Struct({
      data: Schema.String,
      sleepCompleted: Schema.Boolean,
    }),
  });

  const Group = InngestGroup.make(ParallelSleepFn);

  const request = (steps: (typeof Protocol.SDKRequestBody.Type)["steps"] = {}) =>
    makeTestRequest({
      fnId: "parallel-sleep",
      eventName: "test/parallel-sleep",
      eventData: { taskId: "task-1" },
      steps,
    });

  it.effect("parallel sleep + run: completion with null sleep result returns 200", () =>
    Effect.gen(function* () {
      const HandlersLive = Group.toLayer({
        "parallel-sleep": ({ event, step }) =>
          Effect.gen(function* () {
            const [data, _] = yield* Effect.all(
              [step.run("fetch-data", Effect.succeed(`Data: ${event.taskId}`)), step.sleep("wait", "5 seconds")],
              { concurrency: "unbounded" },
            );
            return { data, sleepCompleted: true };
          }),
      });

      const { handler, dispose } = InngestGroup.toWebHandler(Group, { layer: makeTestLayer(HandlersLive) });

      try {
        // First call - get the step hashes from the response
        const firstResponse = yield* Effect.tryPromise(() => handler(request()));
        expect(firstResponse.status).toBe(206);

        const opcodes = (yield* Effect.tryPromise(() => firstResponse.json())) as Array<{
          op: string;
          id: string;
          name: string;
        }>;
        expect(opcodes).toHaveLength(2);

        // Build steps map with correct hashes - sleep result is null
        const steps: Record<string, { data: unknown } | null> = {};
        for (const opcode of opcodes) {
          if (opcode.op === "Sleep") {
            steps[opcode.id] = null; // Sleep returns null
          } else {
            steps[opcode.id] = { data: "Data: task-1" };
          }
        }

        // Second call with memoized steps including null for sleep
        const response = yield* Effect.tryPromise(() => handler(request(steps)));

        // Should return 200 (completed) because null sleep result is properly memoized
        expect(response.status).toBe(200);

        const body = yield* Effect.tryPromise(() => response.json());
        expect(body).toEqual({
          data: "Data: task-1",
          sleepCompleted: true,
        });
      } finally {
        yield* Effect.tryPromise(() => dispose());
      }
    }),
  );
});

class TestMultiStep extends Schema.TaggedClass<TestMultiStep>()("test/multi-step", {
  value: Schema.String,
}) {}

describe("Regression: URL stepId must override body.ctx.step_id", () => {
  /**
   * Bug: The URL query parameter `stepId` was ignored (prefixed with _).
   * The handler always used body.ctx.step_id which is always "step".
   * When Inngest requested execution of a specific step via URL stepId,
   * the Driver couldn't match it because ctx.step_id was wrong.
   * Fix: Handler now overrides body.ctx.step_id with URL stepId when provided.
   */
  const MultiStepFn = InngestFunction.make("multi-step", {
    trigger: { event: TestMultiStep },
    success: Schema.Struct({ result: Schema.String }),
  });

  const Group = InngestGroup.make(MultiStepFn);

  it.effect("specific stepId in URL causes that step to execute", () =>
    Effect.gen(function* () {
      const HandlersLive = Group.toLayer({
        "multi-step": ({ step }) =>
          Effect.gen(function* () {
            const a = yield* step.run("step-a", Effect.succeed("A"));
            const b = yield* step.run("step-b", Effect.succeed("B"));
            return { result: `${a}-${b}` };
          }),
      });

      const { handler, dispose } = InngestGroup.toWebHandler(Group, { layer: makeTestLayer(HandlersLive) });

      try {
        // First call - disable_immediate_execution is FALSE (first call behavior)
        const firstRequest = makeTestRequest({
          fnId: "multi-step",
          eventName: "test/multi-step",
          eventData: { value: "test" },
          steps: {},
          disableImmediateExecution: false, // First call executes steps immediately
        });
        const firstResponse = yield* Effect.tryPromise(() => handler(firstRequest));
        expect(firstResponse.status).toBe(206);

        const opcodes = (yield* Effect.tryPromise(() => firstResponse.json())) as Array<{
          op: string;
          id: string;
          name: string;
          data?: unknown;
        }>;

        // First step should execute and return StepRun with data
        const stepA = opcodes.find((o) => o.name === "step-a");
        expect(stepA).toBeDefined();
        expect(stepA!.op).toBe("StepRun");
        expect(stepA!.data).toBe("A");

        // Second call with step-a memoized, should execute step-b
        const secondRequest = makeTestRequest({
          fnId: "multi-step",
          eventName: "test/multi-step",
          eventData: { value: "test" },
          steps: { [stepA!.id]: { data: "A" } },
          disableImmediateExecution: false, // Continue execution
        });
        const secondResponse = yield* Effect.tryPromise(() => handler(secondRequest));
        expect(secondResponse.status).toBe(206);

        const secondOpcodes = (yield* Effect.tryPromise(() => secondResponse.json())) as Array<{
          op: string;
          id: string;
          name: string;
          data?: unknown;
        }>;

        const stepB = secondOpcodes.find((o) => o.name === "step-b");
        expect(stepB).toBeDefined();
        expect(stepB!.op).toBe("StepRun");
        expect(stepB!.data).toBe("B");

        // Final call with both steps memoized
        const finalRequest = makeTestRequest({
          fnId: "multi-step",
          eventName: "test/multi-step",
          eventData: { value: "test" },
          steps: {
            [stepA!.id]: { data: "A" },
            [stepB!.id]: { data: "B" },
          },
          disableImmediateExecution: false,
        });
        const finalResponse = yield* Effect.tryPromise(() => handler(finalRequest));
        expect(finalResponse.status).toBe(200);

        const result = yield* Effect.tryPromise(() => finalResponse.json());
        expect(result).toEqual({ result: "A-B" });
      } finally {
        yield* Effect.tryPromise(() => dispose());
      }
    }),
  );
});

class TestParent extends Schema.TaggedClass<TestParent>()("test/parent", {
  value: Schema.Number,
}) {}

class TestChild extends Schema.TaggedClass<TestChild>()("test/child", {
  value: Schema.Number,
}) {}

describe("Regression: step.invoke payload must be event data directly", () => {
  /**
   * Bug: step.invoke was sending opts.payload = { data, user, v } but Inngest
   * expects opts.payload to be the event data directly (e.g., { value: 42 }).
   * This caused Inngest to not recognize the invoke and the parent function
   * would hang waiting for the child to complete.
   * Fix: Changed Driver.ts to send opts.payload = options.data (event data directly).
   */
  const ChildFn = InngestFunction.make("child-fn", {
    trigger: { event: TestChild },
    success: Schema.Struct({ doubled: Schema.Number }),
  });

  const ParentFn = InngestFunction.make("parent-fn", {
    trigger: { event: TestParent },
    success: Schema.Struct({ result: Schema.Number }),
  });

  const Group = InngestGroup.make(ParentFn, ChildFn);

  it.effect("invoke opcode has payload wrapped in { data } per Inngest protocol", () =>
    Effect.gen(function* () {
      const HandlersLive = Group.toLayer({
        "parent-fn": ({ event, step }) =>
          Effect.gen(function* () {
            const childResult = yield* step.invoke("call-child", {
              function: ChildFn,
              data: TestChild.make({ value: event.value * 2 }),
            });
            return { result: childResult.doubled };
          }),
        "child-fn": ({ event, step }) =>
          Effect.gen(function* () {
            const doubled = yield* step.run("double", Effect.succeed(event.value * 2));
            return { doubled };
          }),
      });

      const { handler, dispose } = InngestGroup.toWebHandler(Group, { layer: makeTestLayer(HandlersLive) });

      try {
        const request = makeTestRequest({
          fnId: "parent-fn",
          eventName: "test/parent",
          eventData: { value: 21 },
          steps: {},
        });

        const response = yield* Effect.tryPromise(() => handler(request));
        expect(response.status).toBe(206);

        const opcodes = (yield* Effect.tryPromise(() => response.json())) as Array<{
          op: string;
          id: string;
          name?: string;
          opts?: {
            function_id?: string;
            payload?: unknown;
          };
        }>;

        expect(opcodes).toMatchInlineSnapshot(`
        	[
        	  {
        	    "data": null,
        	    "displayName": "call-child",
        	    "id": "93f72581df96e9a8f01f1481b3570b4e9370a0a6",
        	    "mode": "async",
        	    "op": "InvokeFunction",
        	    "opts": {
        	      "function_id": "test-app-child-fn",
        	      "payload": {
        	        "data": {
        	          "_tag": "test/child",
        	          "value": 42,
        	        },
        	      },
        	      "timeout": "365d",
        	    },
        	    "userland": {
        	      "id": "call-child",
        	    },
        	  },
        	]
        `);

        const invokeOp = opcodes.find((o) => o.op === "InvokeFunction");
        expect(invokeOp).toBeDefined();
        expect(invokeOp!.name).toBeUndefined();

        expect(invokeOp!.opts?.payload).toEqual({ data: { _tag: "test/child", value: 42 } });

        expect(invokeOp!.opts?.payload).toHaveProperty("data");
        expect(invokeOp!.opts?.payload).toMatchInlineSnapshot(`
          {
            "data": {
              "_tag": "test/child",
              "value": 42,
            },
          }
        `);
      } finally {
        yield* Effect.tryPromise(() => dispose());
      }
    }),
  );
});

class TestNonRetriable extends Schema.TaggedClass<TestNonRetriable>()("test/non-retriable", {
  shouldFail: Schema.Boolean,
}) {}

describe("Regression: NonRetriableError must set X-Inngest-No-Retry header", () => {
  /**
   * Bug: When a handler throws NonRetriableError, the SDK always returns
   * X-Inngest-No-Retry: "false", causing Inngest to retry the function.
   * The function never reaches FAILED status because it keeps retrying.
   * Error: Timeout waiting for function to reach status "FAILED"
   * Fix: Check for NonRetriableError and set X-Inngest-No-Retry: "true"
   *
   * @see .research/012-error-non-retriable.ts
   */
  const NonRetriableFn = InngestFunction.make("non-retriable-fn", {
    trigger: { event: TestNonRetriable },
    success: Schema.Struct({ result: Schema.String }),
  });

  const Group = InngestGroup.make(NonRetriableFn);

  it.effect("handler throwing NonRetriableError directly sets X-Inngest-No-Retry: true", () =>
    Effect.gen(function* () {
      const HandlersLive = Group.toLayer({
        "non-retriable-fn": () => Effect.fail(new NonRetriableError({ message: "Direct failure" })),
      });

      const { handler, dispose } = InngestGroup.toWebHandler(Group, { layer: makeTestLayer(HandlersLive) });

      try {
        const request = makeTestRequest({
          fnId: "non-retriable-fn",
          eventName: "test/non-retriable",
          eventData: { shouldFail: true },
          steps: {},
        });

        const response = yield* Effect.tryPromise(() => handler(request));

        // Spec §4.4.3: non-retriable function errors MUST return 400
        expect(response.status).toBe(400);

        // CRITICAL: X-Inngest-No-Retry must be "true" for NonRetriableError
        // BUG: Currently returns "false" causing infinite retries
        const noRetryHeader = response.headers.get(Protocol.Headers.NoRetry);
        expect(noRetryHeader).toBe("true");
      } finally {
        yield* Effect.tryPromise(() => dispose());
      }
    }),
  );

  it.effect("step failure emits native StepFailed opcode and sets no-retry header", () =>
    Effect.gen(function* () {
      const HandlersLive = Group.toLayer({
        "non-retriable-fn": ({ step }) =>
          step.run("fail-step", Effect.fail(new NonRetriableError({ message: "Step no retry" }))),
      });

      const { handler, dispose } = InngestGroup.toWebHandler(Group, { layer: makeTestLayer(HandlersLive) });

      try {
        // Use disableImmediateExecution: false to trigger step execution
        const request = makeTestRequest({
          fnId: "non-retriable-fn",
          eventName: "test/non-retriable",
          eventData: { shouldFail: true },
          steps: {},
          disableImmediateExecution: false,
        });

        const response = yield* Effect.tryPromise(() => handler(request));

        // Step failures return 206 with StepFailed opcode
        expect(response.status).toBe(206);
        expect(response.headers.get(Protocol.Headers.NoRetry)).toBe("true");

        const body = (yield* Effect.tryPromise(() => response.json())) as ReadonlyArray<{
          op: string;
          name: string;
          error: { name: string; message: string; noRetry?: boolean };
          data?: { name?: string; message?: string };
        }>;

        expect(body).toHaveLength(1);
        const opcode = body[0]!;
        expect(opcode.op).toBe("StepFailed");
        expect(opcode.error.name).toBe("NonRetriableError");
        expect(opcode.error.message).toBe("Step no retry");
        expect(opcode.data).toMatchObject({ name: "NonRetriableError", message: "Step no retry" });
      } finally {
        yield* Effect.tryPromise(() => dispose());
      }
    }),
  );
});

class TestBatchEvent extends Schema.TaggedClass<TestBatchEvent>()("test/batch", {
  userId: Schema.String,
  item: Schema.String,
}) {}

describe("Regression: Batch events handler receives array of event data", () => {
  /**
   * Bug: When batchEvents is configured, handler receives single event instead of array.
   * buildHandlerContext always used request.event.data even when request.events had multiple items.
   * Error: events.map is not a function (In 'events.map((e) => e.item)', 'events.map' is undefined)
   * Fix: Check if fn.options.batchEvents is configured, if so return array of event.data payloads.
   *
   * @see .research/048-batch-events-key.ts
   */
  const BatchFn = InngestFunction.make("batch-fn", {
    trigger: { event: TestBatchEvent },
    success: Schema.Struct({
      items: Schema.Array(Schema.String),
      count: Schema.Number,
    }),
    // Must have batchEvents configured to trigger batch mode
    batchEvents: { maxSize: 10, timeout: Duration.seconds(1) },
  });

  const Group = InngestGroup.make(BatchFn);

  it.effect("handler receives array when events.length > 1", () =>
    Effect.gen(function* () {
      const HandlersLive = Group.toLayer({
        "batch-fn": ({ event }) =>
          Effect.gen(function* () {
            // In batch mode, event should be an array
            const events = event as unknown as ReadonlyArray<TestBatchEvent>;
            const items = events.map((e) => e.item);
            return { items, count: events.length };
          }),
      });

      const { handler, dispose } = InngestGroup.toWebHandler(Group, { layer: makeTestLayer(HandlersLive) });

      try {
        // Simulate batch request with multiple events
        const batchRequest = new Request("http://localhost:9999/?fnId=batch-fn", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(
            Protocol.SDKRequestBody.make({
              ctx: Protocol.SDKRequestContext.make({
                attempt: 1,
                disable_immediate_execution: false,
                run_id: "run-batch",
                stack: Protocol.FunctionStack.make({ stack: [], current: 0 }),
                env: "test",
                fn_id: "batch-fn",
                step_id: "step",
                use_api: false,
                max_attempts: 4,
                qi_id: "qi_batch",
              }),
              event: Protocol.InngestEvent.make({
                name: "test/batch",
                data: { userId: "user-1", item: "item-a" },
                id: "evt_1",
                ts: Date.now(),
              }),
              // Multiple events = batch mode
              events: [
                Protocol.InngestEvent.make({
                  name: "test/batch",
                  data: { userId: "user-1", item: "item-a" },
                  id: "evt_1",
                  ts: Date.now(),
                }),
                Protocol.InngestEvent.make({
                  name: "test/batch",
                  data: { userId: "user-1", item: "item-b" },
                  id: "evt_2",
                  ts: Date.now(),
                }),
                Protocol.InngestEvent.make({
                  name: "test/batch",
                  data: { userId: "user-1", item: "item-c" },
                  id: "evt_3",
                  ts: Date.now(),
                }),
              ],
              steps: {},
              version: 1,
              use_api: false,
            }),
          ),
        });

        const response = yield* Effect.tryPromise(() => handler(batchRequest));
        expect(response.status).toBe(200);

        const result = yield* Effect.tryPromise(() => response.json());
        expect(result).toEqual({
          items: ["item-a", "item-b", "item-c"],
          count: 3,
        });
      } finally {
        yield* Effect.tryPromise(() => dispose());
      }
    }),
  );
});

class TestWaitEvent extends Schema.TaggedClass<TestWaitEvent>()("test/wait-trigger", {
  orderId: Schema.String,
}) {}

class TestApprovalEvent extends Schema.TaggedClass<TestApprovalEvent>()("test/approval", {
  orderId: Schema.String,
  approvedBy: Schema.String,
}) {}

describe("Regression: waitForEvent returns event.data payload, not full event", () => {
  /**
   * Bug: waitForEvent MemoData handler returned the full event { name, data, id, ts }
   * but the schema type E only represents the payload (e.g., { orderId, approvedBy }).
   * Handler expected approval.value.approvedBy but got approval.value.data.approvedBy.
   * Fix: Extract .data from the memoized event to return just the payload.
   *
   * @see test/integration/wait-for-event.test.ts
   */
  const WaitFn = InngestFunction.make("wait-fn", {
    trigger: { event: TestWaitEvent },
    success: Schema.Struct({
      orderId: Schema.String,
      approvedBy: Schema.String,
    }),
  });

  const Group = InngestGroup.make(WaitFn);

  it.effect("waitForEvent result has payload fields directly accessible", () =>
    Effect.gen(function* () {
      const HandlersLive = Group.toLayer({
        "wait-fn": ({ event, step }) =>
          Effect.gen(function* () {
            const approval = yield* step.waitForEvent("wait-approval", TestApprovalEvent, {
              timeout: Duration.hours(1),
              if: `async.data.orderId == "${event.orderId}"`,
            });
            // approval should have approvedBy directly, not nested in .data
            const approvedBy = Option.isSome(approval) ? approval.value.approvedBy : "none";
            return {
              orderId: event.orderId,
              approvedBy,
            };
          }),
      });

      const { handler, dispose } = InngestGroup.toWebHandler(Group, { layer: makeTestLayer(HandlersLive) });

      try {
        // First call - emit WaitForEvent opcode
        const firstResponse = yield* Effect.tryPromise(() =>
          handler(
            makeTestRequest({
              fnId: "wait-fn",
              eventName: "test/wait-trigger",
              eventData: { orderId: "order-123" },
              steps: {},
            }),
          ),
        );
        expect(firstResponse.status).toBe(206);

        const opcodes = (yield* Effect.tryPromise(() => firstResponse.json())) as Array<{
          op: string;
          id: string;
        }>;
        const waitOp = opcodes.find((o) => o.op === "WaitForEvent");
        expect(waitOp).toBeDefined();

        // Second call - with memoized waitForEvent result (full event object)
        // Inngest returns the full event: { name, data: {...}, id, ts }
        const secondResponse = yield* Effect.tryPromise(() =>
          handler(
            makeTestRequest({
              fnId: "wait-fn",
              eventName: "test/wait-trigger",
              eventData: { orderId: "order-123" },
              steps: {
                [waitOp!.id]: {
                  data: {
                    name: "test/approval",
                    data: { orderId: "order-123", approvedBy: "admin@example.com" },
                    id: "evt_approval",
                    ts: Date.now(),
                  },
                },
              },
            }),
          ),
        );

        expect(secondResponse.status).toBe(200);

        const result = yield* Effect.tryPromise(() => secondResponse.json());
        // The handler should access approval.value.approvedBy directly
        // Without the fix, this would fail because approvedBy would be at approval.value.data.approvedBy
        expect(result).toEqual({
          orderId: "order-123",
          approvedBy: "admin@example.com",
        });
      } finally {
        yield* Effect.tryPromise(() => dispose());
      }
    }),
  );

  it.effect("waitForEvent works when Inngest sends payload directly (not wrapped in event)", () =>
    Effect.gen(function* () {
      const HandlersLive = Group.toLayer({
        "wait-fn": ({ event, step }) =>
          Effect.gen(function* () {
            const approval = yield* step.waitForEvent("wait-approval", TestApprovalEvent, {
              timeout: Duration.hours(1),
              if: `async.data.orderId == "${event.orderId}"`,
            });
            const approvedBy = Option.isSome(approval) ? approval.value.approvedBy : "none";
            return {
              orderId: event.orderId,
              approvedBy,
            };
          }),
      });

      const { handler, dispose } = InngestGroup.toWebHandler(Group, { layer: makeTestLayer(HandlersLive) });

      try {
        const firstResponse = yield* Effect.tryPromise(() =>
          handler(
            makeTestRequest({
              fnId: "wait-fn",
              eventName: "test/wait-trigger",
              eventData: { orderId: "order-123" },
              steps: {},
            }),
          ),
        );
        expect(firstResponse.status).toBe(206);

        const opcodes = (yield* Effect.tryPromise(() => firstResponse.json())) as Array<{
          op: string;
          id: string;
        }>;
        const waitOp = opcodes.find((o) => o.op === "WaitForEvent");
        expect(waitOp).toBeDefined();

        // Second call - Inngest sends payload DIRECTLY (not wrapped in full event)
        // This is an alternative format Inngest may use
        const secondResponse = yield* Effect.tryPromise(() =>
          handler(
            makeTestRequest({
              fnId: "wait-fn",
              eventName: "test/wait-trigger",
              eventData: { orderId: "order-123" },
              steps: {
                [waitOp!.id]: {
                  // Payload directly in data, NOT wrapped in { name, data, id, ts }
                  data: { orderId: "order-123", approvedBy: "admin@example.com" },
                },
              },
            }),
          ),
        );

        expect(secondResponse.status).toBe(200);

        const result = yield* Effect.tryPromise(() => secondResponse.json());
        expect(result).toEqual({
          orderId: "order-123",
          approvedBy: "admin@example.com",
        });
      } finally {
        yield* Effect.tryPromise(() => dispose());
      }
    }),
  );

  it.effect("waitForEvent returns None when data is null (timeout)", () =>
    Effect.gen(function* () {
      const HandlersLive = Group.toLayer({
        "wait-fn": ({ event, step }) =>
          Effect.gen(function* () {
            const approval = yield* step.waitForEvent("wait-approval", TestApprovalEvent, {
              timeout: Duration.hours(1),
              if: `async.data.orderId == "${event.orderId}"`,
            });
            const approvedBy = Option.isSome(approval) ? approval.value.approvedBy : "timeout";
            return {
              orderId: event.orderId,
              approvedBy,
            };
          }),
      });

      const { handler, dispose } = InngestGroup.toWebHandler(Group, { layer: makeTestLayer(HandlersLive) });

      try {
        const firstResponse = yield* Effect.tryPromise(() =>
          handler(
            makeTestRequest({
              fnId: "wait-fn",
              eventName: "test/wait-trigger",
              eventData: { orderId: "order-123" },
              steps: {},
            }),
          ),
        );
        const opcodes = (yield* Effect.tryPromise(() => firstResponse.json())) as Array<{
          op: string;
          id: string;
        }>;
        const waitOp = opcodes.find((o) => o.op === "WaitForEvent");

        // null data = timeout
        const secondResponse = yield* Effect.tryPromise(() =>
          handler(
            makeTestRequest({
              fnId: "wait-fn",
              eventName: "test/wait-trigger",
              eventData: { orderId: "order-123" },
              steps: {
                [waitOp!.id]: { data: null },
              },
            }),
          ),
        );

        expect(secondResponse.status).toBe(200);
        const result = yield* Effect.tryPromise(() => secondResponse.json());
        expect(result).toEqual({
          orderId: "order-123",
          approvedBy: "timeout",
        });
      } finally {
        yield* Effect.tryPromise(() => dispose());
      }
    }),
  );
});

class TestSequential extends Schema.TaggedClass<TestSequential>()("test/sequential", {
  id: Schema.String,
}) {}

describe("Regression: disable_immediate_execution must not block target step", () => {
  /**
   * Bug: When disable_immediate_execution was true, ALL steps emitted StepPlanned,
   * even the specific step Inngest asked to execute via URL stepId.
   * Fix: Now checks if current step is the target (ctx.step_id === stepHash)
   * BEFORE checking disable_immediate_execution.
   */
  const SequentialFn = InngestFunction.make("sequential", {
    trigger: { event: TestSequential },
    success: Schema.Struct({ steps: Schema.Array(Schema.String) }),
  });

  const Group = InngestGroup.make(SequentialFn);

  it.effect("target step executes even when disable_immediate_execution is true", () =>
    Effect.gen(function* () {
      const HandlersLive = Group.toLayer({
        sequential: ({ step }) =>
          Effect.gen(function* () {
            const a = yield* step.run("first", Effect.succeed("first"));
            const b = yield* step.run("second", Effect.succeed("second"));
            const c = yield* step.run("third", Effect.succeed("third"));
            return { steps: [a, b, c] };
          }),
      });

      const { handler, dispose } = InngestGroup.toWebHandler(Group, { layer: makeTestLayer(HandlersLive) });

      try {
        // First call - execute first step (disable_immediate_execution: false)
        const firstResponse = yield* Effect.tryPromise(() =>
          handler(
            makeTestRequest({
              fnId: "sequential",
              eventName: "test/sequential",
              eventData: { id: "test-1" },
              steps: {},
              disableImmediateExecution: false, // First call executes immediately
            }),
          ),
        );
        expect(firstResponse.status).toBe(206);

        const firstOpcodes = (yield* Effect.tryPromise(() => firstResponse.json())) as Array<{
          op: string;
          id: string;
          name: string;
          data?: unknown;
        }>;

        expect(firstOpcodes).toMatchObject([
          {
            data: "first",
            displayName: "first",
            id: "e0996a37c13d44c3b06074939d43fa3759bd32c1",
            name: "first",
            op: "StepRun",
            opts: {},
            timing: { b: 0 },
            userland: { id: "first" },
          },
        ]);
        expect(typeof (firstOpcodes[0] as { timing?: { a?: unknown } }).timing?.a).toBe("number");

        const firstStep = firstOpcodes.find((o) => o.name === "first");
        expect(firstStep).toBeDefined();
        expect(firstStep!.op).toBe("StepRun");

        // Second call - with disable_immediate_execution: true and specific stepId
        // This simulates what Inngest does after first step completes
        const secondRequest = makeTestRequest({
          fnId: "sequential",
          eventName: "test/sequential",
          eventData: { id: "test-1" },
          steps: { [firstStep!.id]: { data: "first" } },
          disableImmediateExecution: true,
        });

        const secondResponse = yield* Effect.tryPromise(() => handler(secondRequest));
        expect(secondResponse.status).toBe(206);

        const secondOpcodes = (yield* Effect.tryPromise(() => secondResponse.json())) as Array<{
          op: string;
          id: string;
          name: string;
          data?: unknown;
        }>;

        expect(secondOpcodes).toMatchInlineSnapshot(`
        	[
        	  {
        	    "data": null,
        	    "displayName": "second",
        	    "id": "352f7829a2384b001cc12b0c2613c756454a1f6a",
        	    "name": "second",
        	    "op": "StepPlanned",
        	    "opts": {},
        	    "userland": {
        	      "id": "second",
        	    },
        	  },
        	]
        `);

        // Second step should be StepPlanned (discovery phase)
        const secondStep = secondOpcodes.find((o) => o.name === "second");
        expect(secondStep).toBeDefined();
        expect(secondStep!.op).toBe("StepPlanned");

        // Third call - Inngest asks to execute "second" step specifically
        // URL: ?stepId=<second-step-hash>
        // This should execute the step even with disable_immediate_execution: true
        const thirdRequest = new Request(`http://localhost:9999/?fnId=sequential&stepId=${secondStep!.id}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(
            Protocol.SDKRequestBody.make({
              ctx: Protocol.SDKRequestContext.make({
                attempt: 1,
                disable_immediate_execution: true, // Still true!
                run_id: "run-123",
                stack: Protocol.FunctionStack.make({ stack: [], current: 0 }),
                env: "test",
                fn_id: "sequential",
                step_id: "step", // Body still says "step", but URL has specific stepId
                use_api: false,
                max_attempts: 4,
                qi_id: "qi_123",
              }),
              event: Protocol.InngestEvent.make({
                name: "test/sequential",
                data: { id: "test-1" },
                id: "evt_1",
                ts: Date.now(),
              }),
              events: [],
              steps: { [firstStep!.id]: { data: "first" } },
              version: 1,
              use_api: false,
            }),
          ),
        });

        const thirdResponse = yield* Effect.tryPromise(() => handler(thirdRequest));
        expect(thirdResponse.status).toBe(206);

        const thirdOpcodes = (yield* Effect.tryPromise(() => thirdResponse.json())) as Array<{
          op: string;
          id: string;
          name: string;
          data?: unknown;
        }>;

        expect(thirdOpcodes).toMatchObject([
          {
            data: "second",
            displayName: "second",
            id: "352f7829a2384b001cc12b0c2613c756454a1f6a",
            name: "second",
            op: "StepRun",
            opts: {},
            timing: { b: 0 },
            userland: { id: "second" },
          },
        ]);
        expect(typeof (thirdOpcodes[0] as { timing?: { a?: unknown } }).timing?.a).toBe("number");

        // NOW second step should EXECUTE (StepRun with data), not just StepPlanned
        const executedSecond = thirdOpcodes.find((o) => o.name === "second");
        expect(executedSecond).toBeDefined();
        expect(executedSecond!.op).toBe("StepRun");
        expect(executedSecond!.data).toBe("second");
      } finally {
        yield* Effect.tryPromise(() => dispose());
      }
    }),
  );
});
