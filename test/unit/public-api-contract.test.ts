import * as HttpClient from "effect/unstable/http/HttpClient";
import * as HttpClientResponse from "effect/unstable/http/HttpClientResponse";
import * as Context from "effect/Context";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import { describe, expect, it } from "@effect/vitest";
import {
  InngestClient,
  InngestCron,
  InngestEvent,
  InngestEvents,
  InngestFunction,
  InngestGroup,
  Inngest,
  NonRetriableError,
  RetryAfterError,
} from "../../src/index.js";

const UserCreated = InngestEvent.make(
  "user/created",
  Schema.Struct({
    userId: Schema.String,
  }),
);

const PaymentProcess = InngestEvent.make(
  "payment/process",
  Schema.Struct({
    orderId: Schema.String,
  }),
);

type Expect<T extends true> = T;
type IsReadonlyArray<T> = T extends ReadonlyArray<unknown> ? true : false;

const NamedNormalizedTrigger: InngestFunction.NormalizedEventTrigger<typeof UserCreated> = { event: UserCreated };
const CronObjectTriggerFn = InngestFunction.make("cron-object-trigger-contract", {
  trigger: { cron: "0 0 * * *", jitter: "5m" },
});
const CronDefinitionTriggerFn = InngestFunction.make("cron-definition-trigger-contract", {
  trigger: InngestCron.make("0 * * * *"),
});

type NormalizedUserCreatedTrigger = InngestFunction.NormalizeTriggers<typeof UserCreated>;
type NormalizedTriggerIsNamed = Expect<
  NormalizedUserCreatedTrigger extends InngestFunction.NormalizedEventTrigger<typeof UserCreated> ? true : false
>;
type CronObjectTrigger = InngestFunction.InngestFunction.Triggers<typeof CronObjectTriggerFn>;
type CronObjectTriggerIsCron = Expect<CronObjectTrigger extends InngestFunction.CronTrigger ? true : false>;
type CronDefinitionTrigger = InngestFunction.InngestFunction.Triggers<typeof CronDefinitionTriggerFn>;
type CronDefinitionTriggerIsCron = Expect<CronDefinitionTrigger extends InngestFunction.CronTrigger ? true : false>;

const NonBatchedHandlerEventFn = InngestFunction.make("non-batched-handler-event", {
  trigger: UserCreated,
  retries: 0,
});

type NonBatchedHandlerEvent = InngestFunction.InngestFunction.EventType<typeof NonBatchedHandlerEventFn>;
type NonBatchedHandlerEventIsSingle = Expect<IsReadonlyArray<NonBatchedHandlerEvent> extends false ? true : false>;

const BatchHandlerEventFn = InngestFunction.make("batched-handler-event", {
  trigger: UserCreated,
  batchEvents: { maxSize: 10, timeout: Duration.seconds(1) },
});

type BatchHandlerEvent = InngestFunction.InngestFunction.EventType<typeof BatchHandlerEventFn>;
type BatchHandlerEventIsArray = Expect<IsReadonlyArray<BatchHandlerEvent>>;

const readNonBatchedHandlerEvent = (event: NonBatchedHandlerEvent) => event.data.userId;
const readBatchedHandlerEvent = (events: BatchHandlerEvent) => events[0]?.data.userId;

const StepRunItem = Schema.Struct({ id: Schema.String });
const StepRunTypeContractFn = InngestFunction.make("step-run-type-contract", {
  trigger: UserCreated,
});
const StepRunTypeContractGroup = InngestGroup.make(StepRunTypeContractFn);
const StepRunTypeContractHandlers = StepRunTypeContractGroup.toLayer({
  "step-run-type-contract": () =>
    Effect.gen(function* () {
      const items = yield* Inngest.run("load-items", Effect.succeed([{ id: "a" }]));
      const ids: ReadonlyArray<string> = items.map((item) => item.id);
      return { count: ids.length };
    }),
});

const mockHttpClient = HttpClient.make((req) =>
  Effect.succeed(
    HttpClientResponse.fromWeb(
      req,
      new Response(JSON.stringify({ message: "ok", ids: ["evt-1"] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    ),
  ),
);

const httpLayer = Layer.succeed(HttpClient.HttpClient, mockHttpClient);

const makeClientLayer = () =>
  InngestClient.layer({ id: "test-app", mode: "dev", checkpointing: false }).pipe(Layer.provide(httpLayer));

const makeExecutionRequest = (options: {
  readonly fnId: string;
  readonly eventName: string;
  readonly eventData: Record<string, unknown>;
  readonly stepId?: string;
  readonly steps?: Record<string, unknown>;
}) => {
  const now = Date.now();
  const stepId = options.stepId ?? "step";
  return new Request(`http://localhost/inngest?fnId=${encodeURIComponent(options.fnId)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      event: {
        name: options.eventName,
        data: options.eventData,
        id: "evt_1",
        ts: now,
      },
      events: [
        {
          name: options.eventName,
          data: options.eventData,
          id: "evt_1",
          ts: now,
        },
      ],
      steps: options.steps ?? {},
      ctx: {
        fn_id: options.fnId,
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

describe("Public event exports", () => {
  it("constructs lifecycle events and finished union accepts both variants", () => {
    const jsonError = InngestEvents.JsonError.make({
      name: "Error",
      message: "boom",
      stack: "stack",
      cause: { reason: "test" },
    });

    const failed = InngestEvents.FunctionFailed.make({
      function_id: "fn_1",
      run_id: "run_1",
      error: jsonError,
      event: { name: "user/created" },
    });
    const finishedError = InngestEvents.FunctionFinishedError.make({
      function_id: "fn_1",
      run_id: "run_1",
      correlation_id: "corr_1",
      error: jsonError,
    });
    const finishedSuccess = InngestEvents.FunctionFinishedSuccess.make({
      function_id: "fn_1",
      run_id: "run_1",
      correlation_id: "corr_1",
      result: { ok: true },
    });
    const cancelled = InngestEvents.FunctionCancelled.make({
      function_id: "fn_1",
      run_id: "run_1",
      correlation_id: "corr_1",
    });
    const invoked = InngestEvents.FunctionInvoked.make({ data: { orderId: "order_1" } });
    const scheduled = InngestEvents.ScheduledTimer.make({ cron: "0 * * * *" });

    expect(failed.name).toBe("inngest/function.failed");
    expect(Schema.is(InngestEvents.FunctionFinished)(finishedError)).toBe(true);
    expect(Schema.is(InngestEvents.FunctionFinished)(finishedSuccess)).toBe(true);
    expect(cancelled.name).toBe("inngest/function.cancelled");
    expect(invoked.data.data).toEqual({ orderId: "order_1" });
    expect(scheduled.data.cron).toBe("0 * * * *");
  });
});

describe("Public handler contracts", () => {
  it.effect("toLayerHandler captures dependencies and serves requests", () =>
    Effect.gen(function* () {
      const TestService = Context.Service<{ readonly prefix: string }>("TestService");
      const ProcessUser = InngestFunction.make("process-user", {
        trigger: UserCreated,
      });
      const group = InngestGroup.make(ProcessUser);

      const handlerLayer = group
        .toLayerHandler("process-user", ({ event }) =>
          Effect.gen(function* () {
            const service = yield* TestService;
            expect(event.name).toBe("user/created");
            return { received: `${service.prefix}:${event.data.userId}` };
          }),
        )
        .pipe(Layer.provide(Layer.succeed(TestService, { prefix: "svc" })));

      const fullLayer = Layer.mergeAll(handlerLayer, makeClientLayer(), httpLayer);
      const { handler, dispose } = InngestGroup.toWebHandler(group, { layer: fullLayer });

      try {
        const response = yield* Effect.tryPromise(() =>
          handler(
            makeExecutionRequest({
              fnId: "test-app-process-user",
              eventName: "user/created",
              eventData: { userId: "u1" },
            }),
          ),
        );

        expect(response.status).toBe(200);
        expect(yield* Effect.tryPromise(() => response.json())).toEqual({ received: "svc:u1" });
      } finally {
        yield* Effect.tryPromise(() => dispose());
      }
    }),
  );

  it.effect("normalizes function return values through JSON wire semantics", () =>
    Effect.gen(function* () {
      const ProcessUser = InngestFunction.make("process-user", {
        trigger: UserCreated,
      });
      const group = InngestGroup.make(ProcessUser);
      const handlers = group.toLayer({
        "process-user": () =>
          Effect.sync(() => {
            const value: Record<string, unknown> = {
              at: new Date("2026-02-03T00:00:00.000Z"),
              nested: { big: 1n },
            };
            value.self = value;
            return value;
          }),
      });

      const fullLayer = Layer.mergeAll(handlers, makeClientLayer(), httpLayer);
      const { handler, dispose } = InngestGroup.toWebHandler(group, { layer: fullLayer });

      try {
        const response = yield* Effect.tryPromise(() =>
          handler(
            makeExecutionRequest({
              fnId: "test-app-process-user",
              eventName: "user/created",
              eventData: { userId: "u1" },
            }),
          ),
        );

        expect(response.status).toBe(200);
        expect(yield* Effect.tryPromise(() => response.json())).toEqual({
          at: "2026-02-03T00:00:00.000Z",
          nested: {},
          self: "[Circular ~]",
        });
      } finally {
        yield* Effect.tryPromise(() => dispose());
      }
    }),
  );

  it.effect("invoked executions expose only the user payload to handlers", () =>
    Effect.gen(function* () {
      const ProcessPayment = InngestFunction.make("process-payment", {
        trigger: PaymentProcess,
      });
      const group = InngestGroup.make(ProcessPayment);
      const handlers = group.toLayer({
        "process-payment": ({ event }) => Effect.succeed({ orderId: event.data.orderId }),
      });

      const fullLayer = Layer.mergeAll(handlers, makeClientLayer(), httpLayer);
      const { handler, dispose } = InngestGroup.toWebHandler(group, { layer: fullLayer });

      try {
        const response = yield* Effect.tryPromise(() =>
          handler(
            makeExecutionRequest({
              fnId: "test-app-process-payment",
              eventName: "inngest/function.invoked",
              eventData: {
                orderId: "order_123",
                _inngest: { function_id: "parent-fn" },
              },
            }),
          ),
        );

        expect(response.status).toBe(200);
        expect(yield* Effect.tryPromise(() => response.json())).toEqual({ orderId: "order_123" });
      } finally {
        yield* Effect.tryPromise(() => dispose());
      }
    }),
  );

  it.effect("function-level NonRetriableError sets the no-retry response header", () =>
    Effect.gen(function* () {
      const ProcessUser = InngestFunction.make("process-user", {
        trigger: UserCreated,
      });
      const group = InngestGroup.make(ProcessUser);
      const handlers = group.toLayer({
        "process-user": () =>
          Effect.fail(
            NonRetriableError.make({
              message: "invalid user payload",
            }),
          ),
      });

      const fullLayer = Layer.mergeAll(handlers, makeClientLayer(), httpLayer);
      const { handler, dispose } = InngestGroup.toWebHandler(group, { layer: fullLayer });

      try {
        const response = yield* Effect.tryPromise(() =>
          handler(
            makeExecutionRequest({
              fnId: "test-app-process-user",
              eventName: "user/created",
              eventData: { userId: "u1" },
            }),
          ),
        );

        // Spec §4.4.3: NonRetriable → 400 with `{name, message, stack?}` at root
        expect(response.status).toBe(400);
        expect(response.headers.get("x-inngest-no-retry")).toBe("true");
        expect(yield* Effect.tryPromise(() => response.json())).toMatchObject({
          name: "NonRetriableError",
          message: "invalid user payload",
        });
      } finally {
        yield* Effect.tryPromise(() => dispose());
      }
    }),
  );

  it.effect("function-level RetryAfterError returns a Retry-After header", () =>
    Effect.gen(function* () {
      const ProcessUser = InngestFunction.make("process-user", {
        trigger: UserCreated,
      });
      const group = InngestGroup.make(ProcessUser);
      const handlers = group.toLayer({
        "process-user": () =>
          Effect.fail(
            RetryAfterError.make({
              message: "retry later",
              retryAfter: Duration.seconds(7),
            }),
          ),
      });

      const fullLayer = Layer.mergeAll(handlers, makeClientLayer(), httpLayer);
      const { handler, dispose } = InngestGroup.toWebHandler(group, { layer: fullLayer });

      try {
        const response = yield* Effect.tryPromise(() =>
          handler(
            makeExecutionRequest({
              fnId: "test-app-process-user",
              eventName: "user/created",
              eventData: { userId: "u1" },
            }),
          ),
        );

        expect(response.status).toBe(500);
        expect(response.headers.get("retry-after")).toBe("7");
        expect(response.headers.get("x-inngest-no-retry")).toBe("false");
      } finally {
        yield* Effect.tryPromise(() => dispose());
      }
    }),
  );
});
