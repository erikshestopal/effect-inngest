import { FetchHttpClient, HttpClient, HttpClientResponse } from "effect/unstable/http";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schedule from "effect/Schedule";
import * as Schema from "effect/Schema";
import { describe, expect, it } from "@effect/vitest";
import { InngestClient, InngestFunction, InngestGroup } from "../../src/index.js";
import * as Protocol from "../../src/internal/protocol.js";
import type { CheckpointApiError } from "../../src/internal/checkpoint.js";

interface CapturedCheckpoint {
  readonly url: string;
  readonly body: { run_id: string; fn_id: string; qi_id: string; steps: ReadonlyArray<{ op: string; id: string }> };
}

const decodeBody = (body: { readonly _tag: string; readonly body?: Uint8Array; readonly text?: string }): unknown => {
  if (body._tag === "Uint8Array" && body.body) return JSON.parse(new TextDecoder().decode(body.body));
  if (body._tag === "Raw" && typeof body.text === "string") return JSON.parse(body.text);
  return undefined;
};

/**
 * Mock HttpClient that records every checkpoint POST and replies per
 * `responder`. Non-checkpoint requests (none expected here) get a 200.
 */
const makeCheckpointMock = (
  captures: Array<CapturedCheckpoint>,
  responder: (idx: number) => Response = () => new Response("{}", { status: 200 }),
) =>
  Layer.effect(
    HttpClient.HttpClient,
    Effect.sync(() =>
      HttpClient.make((request) => {
        if (request.url.includes("/v1/checkpoint/")) {
          const idx = captures.length;
          captures.push({
            url: request.url,
            body: decodeBody(request.body as never) as CapturedCheckpoint["body"],
          });
          return Effect.succeed(HttpClientResponse.fromWeb(request, responder(idx)));
        }
        return Effect.succeed(HttpClientResponse.fromWeb(request, new Response("{}", { status: 200 })));
      }),
    ),
  );

const makeRequest = (options: {
  readonly fnId: string;
  readonly eventName: string;
  readonly eventData: Record<string, unknown>;
  readonly steps?: Record<string, unknown>;
  readonly stepIdQuery?: string;
  readonly disableImmediateExecution?: boolean;
}) => {
  const url = options.stepIdQuery
    ? `http://localhost/?fnId=${options.fnId}&stepId=${options.stepIdQuery}`
    : `http://localhost/?fnId=${options.fnId}`;
  return new Request(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(
      Protocol.SDKRequestBody.make({
        event: Protocol.InngestEvent.make({ name: options.eventName, data: options.eventData, id: "evt", ts: 1 }),
        events: [],
        steps: (options.steps ?? {}) as never,
        ctx: Protocol.SDKRequestContext.make({
          fn_id: options.fnId,
          run_id: "run-1",
          env: "dev",
          step_id: "step",
          attempt: 0,
          max_attempts: 4,
          stack: Protocol.FunctionStack.make({ stack: [], current: 0 }),
          qi_id: "qi-1",
          disable_immediate_execution: options.disableImmediateExecution ?? false,
          use_api: false,
        }),
        version: 1,
        use_api: false,
      }),
    ),
  });
};

const TEST_FACTORY_KEY = Symbol.for("effect-inngest/internal/test-retry-schedule-factory");
const layerWithRetrySchedule = (InngestClient.InngestClient as unknown as Record<symbol, unknown>)[
  TEST_FACTORY_KEY
] as (
  config: Parameters<typeof InngestClient.layer>[0],
  retrySchedule: Schedule.Schedule<unknown, CheckpointApiError>,
) => Layer.Layer<InngestClient.InngestClient, never, HttpClient.HttpClient>;

const makeClient = (
  overrides: Partial<{
    checkpointing: unknown;
    signingKey: string;
    checkpointRetrySchedule: Schedule.Schedule<unknown, CheckpointApiError>;
  }> = {},
) => {
  const config = {
    id: "test-app",
    eventKey: "ek",
    mode: "dev" as const,
    signingKey: overrides.signingKey ?? "signkey-prod-deadbeef",
    checkpointing: (overrides.checkpointing ?? true) as never,
  };
  return overrides.checkpointRetrySchedule
    ? layerWithRetrySchedule(config, overrides.checkpointRetrySchedule)
    : InngestClient.layer(config);
};

class TestEvent extends Schema.TaggedClass<TestEvent>()("ckpt/test", { value: Schema.String }) {}

describe("Checkpoint async integration (spec §10.4.1)", () => {
  const Fn = InngestFunction.make("ckpt-fn", {
    trigger: { event: TestEvent },
    success: Schema.Unknown,
  });
  const Group = InngestGroup.make(Fn);

  // Default checkpointing config keeps maxRuntime small so the maxRuntime race
  // inside the driver doesn't hold the test fiber on its loser-interrupt path
  // longer than necessary. Individual tests can override.
  const defaultCp = { bufferedSteps: 1, maxRuntime: "30 seconds" } as const;

  const setup = (
    handler: Parameters<typeof Group.toLayer>[0]["ckpt-fn"],
    options: {
      readonly responder?: (idx: number) => Response;
      readonly checkpointing?: unknown;
      readonly checkpointRetrySchedule?: Schedule.Schedule<unknown, CheckpointApiError>;
    } = {},
  ) => {
    const captures: Array<CapturedCheckpoint> = [];
    const httpLayer = makeCheckpointMock(captures, options.responder);
    const HandlersLive = Group.toLayer({ "ckpt-fn": handler });
    const checkpointing = options.checkpointing ?? defaultCp;
    const ClientLive = makeClient({ checkpointing, checkpointRetrySchedule: options.checkpointRetrySchedule }).pipe(
      Layer.provide(httpLayer),
    );
    const TestLayer = Layer.mergeAll(HandlersLive, ClientLive, httpLayer, FetchHttpClient.layer);
    return { captures, layer: TestLayer };
  };

  it.effect("default bufferedSteps=1 flushes after each step", () =>
    Effect.gen(function* () {
      const { captures, layer } = setup(({ step }) =>
        Effect.gen(function* () {
          yield* step.run("a", Effect.succeed("A"));
          yield* step.run("b", Effect.succeed("B"));
          return "done";
        }),
      );
      const { handler, dispose } = InngestGroup.toWebHandler(Group, { layer });
      try {
        const response = yield* Effect.tryPromise(() =>
          handler(makeRequest({ fnId: "ckpt-fn", eventName: "ckpt/test", eventData: { value: "v" } })),
        );
        expect(response.status).toBe(206);
        // Default bufferedSteps=1 → 2 checkpoint POSTs (one per step)
        expect(captures.length).toBe(2);
        const body = (yield* Effect.tryPromise(() => response.json())) as Array<{ op: string }>;
        // Buffer fully checkpointed → final 206 contains only RunComplete
        expect(body).toHaveLength(1);
        expect(body[0]!.op).toBe("RunComplete");
      } finally {
        yield* Effect.tryPromise(() => dispose());
      }
    }),
  );

  it.effect("bufferedSteps=2 flushes after every two steps", () =>
    Effect.gen(function* () {
      const { captures, layer } = setup(
        ({ step }) =>
          Effect.gen(function* () {
            yield* step.run("a", Effect.succeed(1));
            yield* step.run("b", Effect.succeed(2));
            yield* step.run("c", Effect.succeed(3));
            return "done";
          }),
        { checkpointing: { bufferedSteps: 2 } },
      );
      const { handler, dispose } = InngestGroup.toWebHandler(Group, { layer });
      try {
        const response = yield* Effect.tryPromise(() =>
          handler(makeRequest({ fnId: "ckpt-fn", eventName: "ckpt/test", eventData: { value: "v" } })),
        );
        expect(response.status).toBe(206);
        // Step a + b reach buffer of 2 → flush (1 POST with 2 ops). Step c
        // remains in buffer until the terminal drain.
        expect(captures.length).toBe(1);
        expect(captures[0]!.body.steps).toHaveLength(2);
        expect(captures[0]!.body.steps.every((s) => s.op === "StepRun")).toBe(true);

        const body = (yield* Effect.tryPromise(() => response.json())) as Array<{ op: string }>;
        // [step c (drained), RunComplete]
        expect(body).toHaveLength(2);
        expect(body[0]!.op).toBe("StepRun");
        expect(body[1]!.op).toBe("RunComplete");
      } finally {
        yield* Effect.tryPromise(() => dispose());
      }
    }),
  );

  it.effect("appends RunComplete on successful completion", () =>
    Effect.gen(function* () {
      const { layer } = setup(() => Effect.succeed({ greeting: "hello" }));
      const { handler, dispose } = InngestGroup.toWebHandler(Group, { layer });
      try {
        const response = yield* Effect.tryPromise(() =>
          handler(makeRequest({ fnId: "ckpt-fn", eventName: "ckpt/test", eventData: { value: "v" } })),
        );
        expect(response.status).toBe(206);
        const body = (yield* Effect.tryPromise(() => response.json())) as Array<{ op: string; data: unknown }>;
        expect(body).toHaveLength(1);
        expect(body[0]!.op).toBe("RunComplete");
      } finally {
        yield* Effect.tryPromise(() => dispose());
      }
    }),
  );

  it.effect("RunComplete carries function return value", () =>
    Effect.gen(function* () {
      const { layer } = setup(() => Effect.succeed({ greeting: "hi" }));
      const { handler, dispose } = InngestGroup.toWebHandler(Group, { layer });
      try {
        const response = yield* Effect.tryPromise(() =>
          handler(makeRequest({ fnId: "ckpt-fn", eventName: "ckpt/test", eventData: { value: "v" } })),
        );
        const body = (yield* Effect.tryPromise(() => response.json())) as Array<{ op: string; data: unknown }>;
        const rc = body.find((op) => op.op === "RunComplete")!;
        expect(rc.data).toEqual({ greeting: "hi" });
      } finally {
        yield* Effect.tryPromise(() => dispose());
      }
    }),
  );

  it.effect("flushes buffer before yielding on async opcode", () =>
    Effect.gen(function* () {
      const { captures, layer } = setup(
        ({ step }) =>
          Effect.gen(function* () {
            yield* step.run("a", Effect.succeed("A"));
            yield* step.sleep("nap", "5 minutes");
            return "x";
          }),
        { checkpointing: { bufferedSteps: 10, maxRuntime: "30 seconds" } },
      );
      const { handler, dispose } = InngestGroup.toWebHandler(Group, { layer });
      try {
        const response = yield* Effect.tryPromise(() =>
          handler(makeRequest({ fnId: "ckpt-fn", eventName: "ckpt/test", eventData: { value: "v" } })),
        );
        expect(response.status).toBe(206);
        // step.sleep forces a flush before yielding.
        expect(captures.length).toBe(1);
        expect(captures[0]!.body.steps[0]!.op).toBe("StepRun");

        const body = (yield* Effect.tryPromise(() => response.json())) as Array<{ op: string }>;
        // Buffer empty after successful flush → only Sleep returns
        expect(body).toHaveLength(1);
        expect(body[0]!.op).toBe("Sleep");
      } finally {
        yield* Effect.tryPromise(() => dispose());
      }
    }),
  );

  it.effect("outbound body contains only StepRun opcodes", () =>
    Effect.gen(function* () {
      const { captures, layer } = setup(({ step }) =>
        Effect.gen(function* () {
          yield* step.run("a", Effect.succeed("A"));
          yield* step.run("b", Effect.succeed("B"));
          return "done";
        }),
      );
      const { handler, dispose } = InngestGroup.toWebHandler(Group, { layer });
      try {
        yield* Effect.tryPromise(() =>
          handler(makeRequest({ fnId: "ckpt-fn", eventName: "ckpt/test", eventData: { value: "v" } })),
        );
        for (const cap of captures) {
          for (const step of cap.body.steps) {
            expect(step.op).toBe("StepRun");
          }
        }
      } finally {
        yield* Effect.tryPromise(() => dispose());
      }
    }),
  );

  it.effect("includes buffered steps before StepError on failure", () =>
    Effect.gen(function* () {
      // bufferedSteps=10 keeps step "a" in the buffer when "boom" fails, so
      // the driver's catchCause path drains it ahead of the StepError opcode.
      const { layer } = setup(
        ({ step }) =>
          Effect.gen(function* () {
            yield* step.run("a", Effect.succeed("A"));
            // Intentional global Error to test arbitrary user failure paths
            // eslint-disable-next-line effect-inngest/no-global-error-in-effect-fail
            yield* step.run("boom", Effect.fail(new Error("kaboom")));
            return "done";
          }),
        { checkpointing: { bufferedSteps: 10, maxRuntime: "30 seconds" } },
      );
      const { handler, dispose } = InngestGroup.toWebHandler(Group, { layer });
      try {
        const response = yield* Effect.tryPromise(() =>
          handler(makeRequest({ fnId: "ckpt-fn", eventName: "ckpt/test", eventData: { value: "v" } })),
        );
        expect(response.status).toBe(206);
        const body = (yield* Effect.tryPromise(() => response.json())) as Array<{ op: string }>;
        expect(body.length).toBeGreaterThanOrEqual(2);
        expect(body.find((o) => o.op === "StepRun")).toBeDefined();
        expect(body.find((o) => o.op === "StepError")).toBeDefined();
      } finally {
        yield* Effect.tryPromise(() => dispose());
      }
    }),
  );

  it.effect(
    "includes buffered steps in 206 when API fails (graceful fallback §10.4.3)",
    () =>
      Effect.gen(function* () {
        // bufferedSteps=1 forces a flush after each step so the API actually
        // gets called (and fails) — exercising the buffer-restore fallback.
        const { captures, layer } = setup(
          ({ step }) =>
            Effect.gen(function* () {
              yield* step.run("a", Effect.succeed("A"));
              yield* step.run("b", Effect.succeed("B"));
              return "done";
            }),
          {
            responder: () => new Response("oops", { status: 500 }),
            checkpointing: { bufferedSteps: 1, maxRuntime: "30 seconds" },
            // Zero-retry schedule — the fallback path is what's under test,
            // not the retry loop. Default 5× exponential (100-1600ms) makes
            // this test take 6+ seconds.
            checkpointRetrySchedule: Schedule.recurs(0),
          },
        );
        const { handler, dispose } = InngestGroup.toWebHandler(Group, { layer });
        try {
          const response = yield* Effect.tryPromise(() =>
            handler(makeRequest({ fnId: "ckpt-fn", eventName: "ckpt/test", eventData: { value: "v" } })),
          );
          expect(response.status).toBe(206);
          const body = (yield* Effect.tryPromise(() => response.json())) as Array<{ op: string }>;
          expect(body.filter((o) => o.op === "StepRun")).toHaveLength(2);
          expect(body[body.length - 1]!.op).toBe("RunComplete");
          // Each step.run with bufferedSteps=1 triggered a flush attempt;
          // each attempt was retried up to 5 times before giving up.
          expect(captures.length).toBeGreaterThan(0);
        } finally {
          yield* Effect.tryPromise(() => dispose());
        }
      }),
    { timeout: 30_000 },
  );

  it.effect("urlStepId disables checkpoint mode", () =>
    Effect.gen(function* () {
      const { captures, layer } = setup(({ step }) =>
        Effect.gen(function* () {
          yield* step.run("a", Effect.succeed("A"));
          return "done";
        }),
      );
      const { handler, dispose } = InngestGroup.toWebHandler(Group, { layer });
      try {
        const response = yield* Effect.tryPromise(() =>
          handler(
            makeRequest({
              fnId: "ckpt-fn",
              eventName: "ckpt/test",
              eventData: { value: "v" },
              stepIdQuery: "step",
              disableImmediateExecution: false,
            }),
          ),
        );
        // No checkpoint POSTs — classic mode in effect.
        expect(captures.length).toBe(0);
        // Step.run yields a single StepRun opcode in 206 (no RunComplete).
        expect(response.status).toBe(206);
      } finally {
        yield* Effect.tryPromise(() => dispose());
      }
    }),
  );

  it.effect("disable_immediate_execution disables checkpoint mode", () =>
    Effect.gen(function* () {
      const { captures, layer } = setup(({ step }) =>
        Effect.gen(function* () {
          yield* step.run("a", Effect.succeed("A"));
          return "done";
        }),
      );
      const { handler, dispose } = InngestGroup.toWebHandler(Group, { layer });
      try {
        const response = yield* Effect.tryPromise(() =>
          handler(
            makeRequest({
              fnId: "ckpt-fn",
              eventName: "ckpt/test",
              eventData: { value: "v" },
              disableImmediateExecution: true,
            }),
          ),
        );
        expect(captures.length).toBe(0);
        expect(response.status).toBe(206);
      } finally {
        yield* Effect.tryPromise(() => dispose());
      }
    }),
  );

  it.effect("function-level false disables checkpoint mode", () =>
    Effect.gen(function* () {
      const FnOff = InngestFunction.make("ckpt-off", {
        trigger: { event: TestEvent },
        success: Schema.Unknown,
        checkpointing: false,
      });
      const GroupOff = InngestGroup.make(FnOff);
      const captures: Array<CapturedCheckpoint> = [];
      const httpLayer = makeCheckpointMock(captures);
      const HandlersLive = GroupOff.toLayer({
        "ckpt-off": ({ step }) =>
          Effect.gen(function* () {
            yield* step.run("a", Effect.succeed("A"));
            return "done";
          }),
      });
      const ClientLive = makeClient({ checkpointing: true }).pipe(Layer.provide(httpLayer));
      const TestLayer = Layer.mergeAll(HandlersLive, ClientLive, httpLayer, FetchHttpClient.layer);

      const { handler, dispose } = InngestGroup.toWebHandler(GroupOff, { layer: TestLayer });
      try {
        const response = yield* Effect.tryPromise(() =>
          handler(makeRequest({ fnId: "ckpt-off", eventName: "ckpt/test", eventData: { value: "v" } })),
        );
        // Per-fn opt-out wins → no checkpoint API calls.
        expect(captures.length).toBe(0);
        expect(response.status).toBe(206);
      } finally {
        yield* Effect.tryPromise(() => dispose());
      }
    }),
  );

  it.effect("enters checkpoint mode under correct conditions", () =>
    Effect.gen(function* () {
      const { captures, layer } = setup(() => Effect.succeed("hi"));
      const { handler, dispose } = InngestGroup.toWebHandler(Group, { layer });
      try {
        const response = yield* Effect.tryPromise(() =>
          handler(makeRequest({ fnId: "ckpt-fn", eventName: "ckpt/test", eventData: { value: "v" } })),
        );
        expect(response.status).toBe(206);
        const body = (yield* Effect.tryPromise(() => response.json())) as Array<{ op: string }>;
        expect(body[0]!.op).toBe("RunComplete");
        // Function returned without steps → no flush calls
        expect(captures.length).toBe(0);
      } finally {
        yield* Effect.tryPromise(() => dispose());
      }
    }),
  );
});
