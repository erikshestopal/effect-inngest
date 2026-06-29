import * as Crypto from "node:crypto";
import { HttpClient, HttpClientResponse } from "effect/unstable/http";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Predicate from "effect/Predicate";
import * as Schema from "effect/Schema";
import { describe, expect, it } from "@effect/vitest";
import {
  InngestClient,
  Inngest,
  InngestFunction,
  InngestGroup,
  NonRetriableError,
  RetryAfterError,
  InngestEvent,
} from "../../src/index.js";
import * as Protocol from "../../src/internal/protocol.js";

interface CapturedRequest {
  readonly method: string;
  readonly url: string;
  readonly path: string;
  readonly body: unknown;
}

interface Opcode {
  readonly op: string;
  readonly id: string;
  readonly name?: string;
  readonly displayName?: string;
  readonly data?: unknown;
  readonly opts?: Record<string, unknown>;
  readonly userland?: { readonly id: string };
}

const decodeBody = (body: { readonly _tag: string; readonly body?: Uint8Array; readonly text?: string }): unknown => {
  if (body._tag === "Uint8Array" && body.body) {
    return JSON.parse(new TextDecoder().decode(body.body));
  }
  if (body._tag === "Raw" && typeof body.text === "string") {
    return JSON.parse(body.text);
  }
  return undefined;
};

const makeHttpClient = (captures: Array<CapturedRequest>) =>
  Layer.effect(
    HttpClient.HttpClient,
    Effect.sync(() =>
      HttpClient.make((request) => {
        const url = new URL(request.url);
        captures.push({
          method: request.method,
          url: request.url,
          path: url.pathname,
          body: decodeBody(request.body as never),
        });

        const responseBody = url.pathname.startsWith("/e/") ? { ids: ["evt_1"], status: 200 } : {};
        return Effect.succeed(
          HttpClientResponse.fromWeb(
            request,
            new Response(JSON.stringify(responseBody), {
              status: 200,
              headers: { "Content-Type": "application/json" },
            }),
          ),
        );
      }),
    ),
  );

const makeRequest = (options: {
  readonly fnId: string;
  readonly eventName: string;
  readonly eventData?: Record<string, unknown>;
  readonly steps?: Record<string, unknown>;
  readonly stepId?: string;
  readonly attempt?: number;
  readonly maxAttempts?: number;
  readonly stack?: ReadonlyArray<string>;
  readonly disableImmediateExecution?: boolean;
}): Request => {
  const stepId = options.stepId ?? "step";
  return new Request(`http://localhost/?fnId=${options.fnId}&stepId=${stepId}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(
      Protocol.SDKRequestBody.make({
        event: Protocol.InngestEvent.make({
          name: options.eventName,
          data: options.eventData ?? {},
          id: "evt_1",
          ts: 1,
        }),
        events: [],
        steps: (options.steps ?? {}) as never,
        ctx: Protocol.SDKRequestContext.make({
          fn_id: options.fnId,
          run_id: "run_1",
          env: "",
          step_id: "step",
          attempt: options.attempt ?? 0,
          max_attempts: options.maxAttempts ?? 5,
          stack: Protocol.FunctionStack.make({
            stack: [...(options.stack ?? [])],
            current: options.stack?.length ?? 0,
          }),
          qi_id: "qi_1",
          request_id: "req_1",
          generation_id: 1,
          disable_immediate_execution: options.disableImmediateExecution ?? false,
          use_api: false,
        }),
        version: 1,
        use_api: false,
      }),
    ),
  });
};

const responseOpcodes = (response: Response): Effect.Effect<ReadonlyArray<Opcode>, unknown> =>
  Effect.tryPromise(() => response.json()).pipe(Effect.map((body) => body as ReadonlyArray<Opcode>));

const checkpointRequests = (captures: ReadonlyArray<CapturedRequest>) =>
  captures.filter((request) => /\/v1\/checkpoint\/[^/]+\/async/u.test(request.path));

const eventRequests = (captures: ReadonlyArray<CapturedRequest>) =>
  captures.filter((request) => request.path.startsWith("/e/"));

const stepNames = (ops: ReadonlyArray<Opcode>) => ops.map((op) => `${op.op}:${op.name ?? ""}`);

const sha1 = (value: string): string => Crypto.createHash("sha1").update(value).digest("hex");

const makeLayer = <A, E, R>(handlers: Layer.Layer<A, E, R>, captures: Array<CapturedRequest>) => {
  const http = makeHttpClient(captures);
  const client = InngestClient.layer({
    id: "native-red",
    mode: "dev",
    signingKey: "signkey-prod-deadbeef",
    checkpointing: { bufferedSteps: 1, maxRuntime: "30 seconds" },
  }).pipe(Layer.provide(http));
  return Layer.mergeAll(handlers, client, http);
};

const DemoEvent = InngestEvent.make("demo/event", Schema.Struct({ value: Schema.Number }));
const EmailSend = InngestEvent.make("email/send", Schema.Struct({ to: Schema.String }));
const InvoicePaid = InngestEvent.make("demo/invoice-paid", Schema.Struct({ invoiceId: Schema.String }));
const ChildInput = InngestEvent.make("demo/child", Schema.Struct({ value: Schema.Number }));
class TestProtocolError extends Schema.TaggedErrorClass<TestProtocolError>()("TestProtocolError", {
  message: Schema.String,
}) {}

describe("native v4 protocol RED regressions", () => {
  it.effect("parallel Inngest.run root request returns StepPlanned ops, not checkpointed StepRun ops", () =>
    Effect.gen(function* () {
      const Fn = InngestFunction.make("parallel-root", {
        trigger: { event: DemoEvent },
      });
      const Group = InngestGroup.make(Fn);
      const captures: Array<CapturedRequest> = [];
      const handlers = Group.toLayer({
        "parallel-root": () =>
          Effect.gen(function* () {
            const results = yield* Effect.all(
              [
                Inngest.run("step-1", Effect.succeed(1)),
                Inngest.run("step-2", Effect.succeed(2)),
                Inngest.run("step-3", Effect.succeed(3)),
              ],
              { concurrency: "unbounded" },
            );
            return { results };
          }),
      });
      const { handler, dispose } = InngestGroup.toWebHandler(Group, { layer: makeLayer(handlers, captures) });

      try {
        const response = yield* Effect.tryPromise(() =>
          handler(makeRequest({ fnId: "parallel-root", eventName: "demo/event", eventData: { value: 1 } })),
        );
        const body = yield* responseOpcodes(response);

        expect(response.status).toBe(206);
        expect(stepNames(body)).toEqual(["StepPlanned:step-1", "StepPlanned:step-2", "StepPlanned:step-3"]);
        for (const op of body) {
          expect(op).toMatchObject({ opts: {}, userland: { id: op.displayName }, data: null });
        }
        expect(checkpointRequests(captures)).toHaveLength(0);
      } finally {
        yield* Effect.tryPromise(() => dispose());
      }
    }),
  );

  it.effect("parallel targeted child request returns one inline StepRun and no checkpoint POST", () =>
    Effect.gen(function* () {
      const Fn = InngestFunction.make("parallel-target", {
        trigger: { event: DemoEvent },
      });
      const Group = InngestGroup.make(Fn);
      const captures: Array<CapturedRequest> = [];
      const handlers = Group.toLayer({
        "parallel-target": () =>
          Effect.gen(function* () {
            const results = yield* Effect.all(
              [
                Inngest.run("step-1", Effect.succeed(1)),
                Inngest.run("step-2", Effect.succeed(2)),
                Inngest.run("step-3", Effect.succeed(3)),
              ],
              { concurrency: "unbounded" },
            );
            return { results };
          }),
      });
      const { handler, dispose } = InngestGroup.toWebHandler(Group, { layer: makeLayer(handlers, captures) });

      try {
        const rootResponse = yield* Effect.tryPromise(() =>
          handler(
            makeRequest({
              fnId: "parallel-target",
              eventName: "demo/event",
              eventData: { value: 1 },
            }),
          ),
        );
        const planned = yield* responseOpcodes(rootResponse);
        const expectedData = new Map([
          [sha1("step-1"), 1],
          [sha1("step-2"), 2],
          [sha1("step-3"), 3],
        ]);

        expect(rootResponse.status).toBe(206);
        expect(planned).toHaveLength(3);

        const executionOrder = [planned[2]!, planned[0]!, planned[1]!];

        const responses = yield* Effect.all(
          executionOrder.map((target) =>
            Effect.gen(function* () {
              const response = yield* Effect.tryPromise(() =>
                handler(
                  makeRequest({
                    fnId: "parallel-target",
                    eventName: "demo/event",
                    eventData: { value: 1 },
                    stepId: target.id,
                    disableImmediateExecution: true,
                  }),
                ),
              );
              const body = yield* responseOpcodes(response);
              return { target, response, body };
            }),
          ),
          { concurrency: "unbounded" },
        );

        for (const { target, response, body } of responses) {
          expect(response.status).toBe(206);
          expect(body).toHaveLength(1);
          expect(body[0]).toMatchObject({
            op: "StepRun",
            id: target.id,
            name: target.name,
            data: expectedData.get(target.id),
          });
        }
        expect(checkpointRequests(captures)).toHaveLength(0);
      } finally {
        yield* Effect.tryPromise(() => dispose());
      }
    }),
  );

  it.effect("mixed parallel root request plans Inngest.run and sendEvent alongside Sleep", () =>
    Effect.gen(function* () {
      const Fn = InngestFunction.make("parallel-mixed-native", {
        trigger: { event: DemoEvent },
      });
      const Group = InngestGroup.make(Fn);
      const captures: Array<CapturedRequest> = [];
      const handlers = Group.toLayer({
        "parallel-mixed-native": () =>
          Effect.gen(function* () {
            yield* Effect.all(
              [
                Inngest.run("compute", Effect.succeed("ok")),
                Inngest.sleep("wait", "2 seconds"),
                Inngest.sendEvent("notify", EmailSend.make({ to: "a@example.com" })),
              ],
              { concurrency: "unbounded" },
            );
            return { result: "done" };
          }),
      });
      const { handler, dispose } = InngestGroup.toWebHandler(Group, { layer: makeLayer(handlers, captures) });

      try {
        const response = yield* Effect.tryPromise(() =>
          handler(makeRequest({ fnId: "parallel-mixed-native", eventName: "demo/event", eventData: { value: 1 } })),
        );
        const body = yield* responseOpcodes(response);

        expect(response.status).toBe(206);
        expect(stepNames(body)).toEqual(["StepPlanned:compute", "Sleep:2s", "StepPlanned:sendEvent"]);
        expect(eventRequests(captures)).toHaveLength(0);
        expect(checkpointRequests(captures)).toHaveLength(0);
      } finally {
        yield* Effect.tryPromise(() => dispose());
      }
    }),
  );

  it.effect("sendEvent uses native StepRun name and missing-key event endpoint", () =>
    Effect.gen(function* () {
      const Fn = InngestFunction.make("send-event-native", {
        trigger: { event: DemoEvent },
      });
      const Group = InngestGroup.make(Fn);
      const captures: Array<CapturedRequest> = [];
      const handlers = Group.toLayer({
        "send-event-native": () =>
          Effect.gen(function* () {
            yield* Inngest.sendEvent("send-notification", EmailSend.make({ to: "a@example.com" }));
            return { ok: true };
          }),
      });
      const { handler, dispose } = InngestGroup.toWebHandler(Group, { layer: makeLayer(handlers, captures) });

      try {
        const response = yield* Effect.tryPromise(() =>
          handler(makeRequest({ fnId: "send-event-native", eventName: "demo/event", eventData: { value: 1 } })),
        );
        const body = yield* responseOpcodes(response);
        const checkpoints = checkpointRequests(captures);

        expect(response.status).toBe(206);
        expect(stepNames(body)).toEqual(["RunComplete:"]);
        expect(eventRequests(captures).map((request) => request.path)).toEqual(["/e/NO_EVENT_KEY_SET"]);
        expect(checkpoints).toHaveLength(1);
        expect((checkpoints[0]!.body as { steps: ReadonlyArray<Opcode> }).steps).toMatchObject([
          { op: "StepRun", name: "sendEvent", displayName: "send-notification", userland: { id: "send-notification" } },
        ]);
      } finally {
        yield* Effect.tryPromise(() => dispose());
      }
    }),
  );

  it.effect("batched sendEvent also checkpoints a native sendEvent StepRun", () =>
    Effect.gen(function* () {
      const Fn = InngestFunction.make("send-event-batch-native", {
        trigger: { event: DemoEvent },
      });
      const Group = InngestGroup.make(Fn);
      const captures: Array<CapturedRequest> = [];
      const handlers = Group.toLayer({
        "send-event-batch-native": () =>
          Effect.gen(function* () {
            yield* Inngest.sendEvent("send-notifications", [
              EmailSend.make({ to: "a@example.com" }),
              EmailSend.make({ to: "b@example.com" }),
            ]);
            return { ok: true };
          }),
      });
      const { handler, dispose } = InngestGroup.toWebHandler(Group, { layer: makeLayer(handlers, captures) });

      try {
        const response = yield* Effect.tryPromise(() =>
          handler(makeRequest({ fnId: "send-event-batch-native", eventName: "demo/event", eventData: { value: 1 } })),
        );
        const checkpoints = checkpointRequests(captures);
        const body = yield* responseOpcodes(response);

        expect(response.status).toBe(206);
        expect(stepNames(body)).toEqual(["RunComplete:"]);
        expect(eventRequests(captures).map((request) => request.path)).toEqual(["/e/NO_EVENT_KEY_SET"]);
        expect((checkpoints[0]!.body as { steps: ReadonlyArray<Opcode> }).steps[0]).toMatchObject({
          op: "StepRun",
          name: "sendEvent",
        });
      } finally {
        yield* Effect.tryPromise(() => dispose());
      }
    }),
  );

  it.effect("waitForEvent opcode name is the waited event name, not the user step id", () =>
    Effect.gen(function* () {
      const Fn = InngestFunction.make("wait-native", {
        trigger: { event: DemoEvent },
      });
      const Group = InngestGroup.make(Fn);
      const captures: Array<CapturedRequest> = [];
      const handlers = Group.toLayer({
        "wait-native": () =>
          Effect.gen(function* () {
            yield* Inngest.waitForEvent("wait-for-payment", InvoicePaid, { timeout: "1 hour" });
            return { ok: true };
          }),
      });
      const { handler, dispose } = InngestGroup.toWebHandler(Group, { layer: makeLayer(handlers, captures) });

      try {
        const response = yield* Effect.tryPromise(() =>
          handler(makeRequest({ fnId: "wait-native", eventName: "demo/event", eventData: { value: 1 } })),
        );
        const body = yield* responseOpcodes(response);

        expect(response.status).toBe(206);
        expect(body).toHaveLength(1);
        expect(body[0]).toMatchObject({
          op: "WaitForEvent",
          name: "demo/invoice-paid",
          displayName: "wait-for-payment",
          opts: { timeout: "1h" },
        });
      } finally {
        yield* Effect.tryPromise(() => dispose());
      }
    }),
  );

  it.effect("invoke opcode omits name and sends only payload.data like native SDK", () =>
    Effect.gen(function* () {
      const Child = InngestFunction.make("child-square", {
        trigger: { event: ChildInput },
      });
      const Parent = InngestFunction.make("invoke-parent-native", {
        trigger: { event: DemoEvent },
      });
      const Group = InngestGroup.make(Parent, Child);
      const captures: Array<CapturedRequest> = [];
      const handlers = Group.toLayer({
        "invoke-parent-native": () =>
          Effect.gen(function* () {
            const child = yield* Inngest.invoke("call-child", {
              function: Child,
              data: ChildInput.make({ value: 7 }),
            });
            return { result: Predicate.hasProperty(child, "squared") ? child.squared : null };
          }),
        "child-square": ({ event }) => Effect.succeed({ squared: event.data.value * event.data.value }),
      });
      const { handler, dispose } = InngestGroup.toWebHandler(Group, { layer: makeLayer(handlers, captures) });

      try {
        const response = yield* Effect.tryPromise(() =>
          handler(makeRequest({ fnId: "invoke-parent-native", eventName: "demo/event", eventData: { value: 1 } })),
        );
        const body = yield* responseOpcodes(response);
        const invoke = body[0]!;

        expect(response.status).toBe(206);
        expect(invoke.op).toBe("InvokeFunction");
        expect(invoke).not.toHaveProperty("name");
        expect(invoke.displayName).toBe("call-child");
        expect(invoke.opts).toMatchObject({
          function_id: "native-red-child-square",
          payload: { data: { value: 7 } },
        });
        expect(invoke.opts?.payload).not.toHaveProperty("user");
        expect(invoke.opts?.payload).not.toHaveProperty("v");
      } finally {
        yield* Effect.tryPromise(() => dispose());
      }
    }),
  );

  it.effect("NonRetriableError inside Inngest.run emits StepFailed with no-retry header", () =>
    Effect.gen(function* () {
      const Fn = InngestFunction.make("non-retriable-native", {
        trigger: { event: DemoEvent },
      });
      const Group = InngestGroup.make(Fn);
      const captures: Array<CapturedRequest> = [];
      const handlers = Group.toLayer({
        "non-retriable-native": () =>
          Effect.gen(function* () {
            return yield* Inngest.run("fail", Effect.fail(new NonRetriableError({ message: "No retry" })));
          }),
      });
      const { handler, dispose } = InngestGroup.toWebHandler(Group, { layer: makeLayer(handlers, captures) });

      try {
        const response = yield* Effect.tryPromise(() =>
          handler(makeRequest({ fnId: "non-retriable-native", eventName: "demo/event", eventData: { value: 1 } })),
        );
        const body = yield* responseOpcodes(response);

        expect(response.status).toBe(206);
        expect(response.headers.get(Protocol.Headers.NoRetry)).toBe("true");
        expect(body).toHaveLength(1);
        expect(body[0]).toMatchObject({ op: "StepFailed", name: "fail", displayName: "fail" });
      } finally {
        yield* Effect.tryPromise(() => dispose());
      }
    }),
  );

  it.effect("last retry attempt emits StepFailed instead of another StepError", () =>
    Effect.gen(function* () {
      const Fn = InngestFunction.make("retry-final-native", {
        trigger: { event: DemoEvent },
      });
      const Group = InngestGroup.make(Fn);
      const captures: Array<CapturedRequest> = [];
      const handlers = Group.toLayer({
        "retry-final-native": () =>
          Effect.gen(function* () {
            return yield* Inngest.run("always-fail", Effect.fail(new TestProtocolError({ message: "boom" })));
          }),
      });
      const { handler, dispose } = InngestGroup.toWebHandler(Group, { layer: makeLayer(handlers, captures) });

      try {
        const response = yield* Effect.tryPromise(() =>
          handler(
            makeRequest({
              fnId: "retry-final-native",
              eventName: "demo/event",
              eventData: { value: 1 },
              attempt: 4,
              maxAttempts: 5,
            }),
          ),
        );
        const body = yield* responseOpcodes(response);

        expect(response.status).toBe(206);
        expect(body).toHaveLength(1);
        expect(body[0]).toMatchObject({ op: "StepFailed", name: "always-fail" });
      } finally {
        yield* Effect.tryPromise(() => dispose());
      }
    }),
  );

  it.effect("a caught Inngest.run failure still yields StepError before user catch recovery", () =>
    Effect.gen(function* () {
      const Fn = InngestFunction.make("step-catch-native", {
        trigger: { event: DemoEvent },
      });
      const Group = InngestGroup.make(Fn);
      const captures: Array<CapturedRequest> = [];
      const handlers = Group.toLayer({
        "step-catch-native": () =>
          Effect.gen(function* () {
            const result = yield* Inngest.run(
              "risky-step",
              Effect.fail(new TestProtocolError({ message: "Something went wrong" })),
            ).pipe(Effect.catch((error: unknown) => Effect.succeed(`Caught error: ${String(error)}`)));
            return { result };
          }),
      });
      const { handler, dispose } = InngestGroup.toWebHandler(Group, { layer: makeLayer(handlers, captures) });

      try {
        const response = yield* Effect.tryPromise(() =>
          handler(makeRequest({ fnId: "step-catch-native", eventName: "demo/event", eventData: { value: 1 } })),
        );
        const body = yield* responseOpcodes(response);

        expect(response.status).toBe(206);
        expect(body).toHaveLength(1);
        expect(body[0]).toMatchObject({ op: "StepError", name: "risky-step", displayName: "risky-step" });
        expect(response.headers.get(Protocol.Headers.NoRetry)).toBe("false");
      } finally {
        yield* Effect.tryPromise(() => dispose());
      }
    }),
  );

  it.effect("retry-success step attempt returns inline StepRun and does not async-checkpoint it", () =>
    Effect.gen(function* () {
      const Fn = InngestFunction.make("retry-success-native", {
        trigger: { event: DemoEvent },
      });
      const Group = InngestGroup.make(Fn);
      const captures: Array<CapturedRequest> = [];
      const handlers = Group.toLayer({
        "retry-success-native": ({ run }) =>
          Effect.gen(function* () {
            const attempts = yield* Inngest.run(
              "flaky-step",
              run.attempt < 1
                ? Effect.fail(new RetryAfterError({ message: "Attempt 0 failed", retryAfter: Duration.seconds(1) }))
                : Effect.succeed(run.attempt + 1),
            );
            return { attempts };
          }),
      });
      const { handler, dispose } = InngestGroup.toWebHandler(Group, { layer: makeLayer(handlers, captures) });

      try {
        const response = yield* Effect.tryPromise(() =>
          handler(
            makeRequest({
              fnId: "retry-success-native",
              eventName: "demo/event",
              eventData: { value: 1 },
              attempt: 1,
              maxAttempts: 6,
            }),
          ),
        );
        const body = yield* responseOpcodes(response);

        expect(response.status).toBe(206);
        expect(body).toHaveLength(1);
        expect(body[0]).toMatchObject({ op: "StepRun", name: "flaky-step", data: 2 });
        expect(checkpointRequests(captures)).toHaveLength(0);
      } finally {
        yield* Effect.tryPromise(() => dispose());
      }
    }),
  );

  it.effect("top-level RetryAfterError returns 500 with Retry-After and no RunComplete", () =>
    Effect.gen(function* () {
      const Fn = InngestFunction.make("retry-after-native", {
        trigger: { event: DemoEvent },
      });
      const Group = InngestGroup.make(Fn);
      const captures: Array<CapturedRequest> = [];
      const handlers = Group.toLayer({
        "retry-after-native": () =>
          Effect.fail(
            new RetryAfterError({ message: "Rate limited by external API", retryAfter: Duration.seconds(1) }),
          ),
      });
      const { handler, dispose } = InngestGroup.toWebHandler(Group, { layer: makeLayer(handlers, captures) });

      try {
        const response = yield* Effect.tryPromise(() =>
          handler(makeRequest({ fnId: "retry-after-native", eventName: "demo/event", eventData: { value: 1 } })),
        );
        const body = (yield* Effect.tryPromise(() => response.json())) as {
          readonly name?: string;
          readonly message?: string;
        };

        expect(response.status).toBe(500);
        expect(response.headers.get(Protocol.Headers.RetryAfter)).toBe("1");
        expect(response.headers.get(Protocol.Headers.NoRetry)).toBe("false");
        expect(body).toMatchObject({ message: "Rate limited by external API" });
        expect(body.name).not.toBe("RunComplete");
      } finally {
        yield* Effect.tryPromise(() => dispose());
      }
    }),
  );

  it.effect("buffered checkpointing drains all completed StepRuns to async checkpoints before RunComplete", () =>
    Effect.gen(function* () {
      const Fn = InngestFunction.make("buffered-native", {
        trigger: { event: DemoEvent },
        checkpointing: { bufferedSteps: 2, maxRuntime: "30 seconds" },
      });
      const Group = InngestGroup.make(Fn);
      const captures: Array<CapturedRequest> = [];
      const handlers = Group.toLayer({
        "buffered-native": () =>
          Effect.gen(function* () {
            yield* Inngest.run("a", Effect.succeed(1));
            yield* Inngest.run("b", Effect.succeed(2));
            yield* Inngest.run("c", Effect.succeed(3));
            yield* Inngest.run("d", Effect.succeed(4));
            return { ok: true };
          }),
      });
      const { handler, dispose } = InngestGroup.toWebHandler(Group, { layer: makeLayer(handlers, captures) });

      try {
        const response = yield* Effect.tryPromise(() =>
          handler(makeRequest({ fnId: "buffered-native", eventName: "demo/event", eventData: { value: 1 } })),
        );
        const body = yield* responseOpcodes(response);
        const checkpoints = checkpointRequests(captures).map(
          (request) => (request.body as { steps: ReadonlyArray<Opcode> }).steps,
        );

        expect(response.status).toBe(206);
        expect(stepNames(body)).toEqual(["RunComplete:"]);
        expect(checkpoints.map((steps) => stepNames(steps))).toEqual([
          ["StepRun:a", "StepRun:b"],
          ["StepRun:c", "StepRun:d"],
        ]);
      } finally {
        yield* Effect.tryPromise(() => dispose());
      }
    }),
  );

  it.effect("sleep flushes buffered StepRuns to async checkpoint and returns only Sleep", () =>
    Effect.gen(function* () {
      const Fn = InngestFunction.make("sleep-flush-native", {
        trigger: { event: DemoEvent },
        checkpointing: { bufferedSteps: 10, maxRuntime: "30 seconds" },
      });
      const Group = InngestGroup.make(Fn);
      const captures: Array<CapturedRequest> = [];
      const handlers = Group.toLayer({
        "sleep-flush-native": () =>
          Effect.gen(function* () {
            yield* Inngest.run("prepare-a", Effect.succeed(1));
            yield* Inngest.run("prepare-b", Effect.succeed(2));
            yield* Inngest.sleep("wait", "2 seconds");
            return { ok: true };
          }),
      });
      const { handler, dispose } = InngestGroup.toWebHandler(Group, { layer: makeLayer(handlers, captures) });

      try {
        const response = yield* Effect.tryPromise(() =>
          handler(makeRequest({ fnId: "sleep-flush-native", eventName: "demo/event", eventData: { value: 1 } })),
        );
        const body = yield* responseOpcodes(response);
        const checkpoints = checkpointRequests(captures);

        expect(response.status).toBe(206);
        expect(stepNames(body)).toEqual(["Sleep:2s"]);
        expect(checkpoints).toHaveLength(1);
        expect(stepNames((checkpoints[0]!.body as { steps: ReadonlyArray<Opcode> }).steps)).toEqual([
          "StepRun:prepare-a",
          "StepRun:prepare-b",
        ]);
      } finally {
        yield* Effect.tryPromise(() => dispose());
      }
    }),
  );
});
