/**
 * Spec §10.4.1 #7: checkpoint mode races the handler against `maxRuntime`.
 * When the deadline wins, the driver emits `DiscoveryRequest` so the executor
 * re-invokes the function, preserving forward progress via buffered steps.
 *
 * Spec §10.1.2 `batch_interval`/`maxInterval` triggers a flush the *next time*
 * a step is buffered after the interval has elapsed.
 *
 * These tests use real (short) timers rather than TestClock because the driver
 * races `Effect.sleep(maxRuntime)` against the user handler — both live on the
 * same Clock, so any deterministic injection would need to be wired through
 * the whole execution environment. Short real timers keep the tests fast and
 * free from Clock plumbing.
 */
import { FetchHttpClient, HttpClient, HttpClientResponse } from "effect/unstable/http";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import { describe, expect, it } from "@effect/vitest";
import { InngestClient, InngestFunction, InngestGroup, InngestEvent, Inngest } from "../../src/index.js";
import * as Protocol from "../../src/internal/protocol.js";

interface CapturedCheckpoint {
  readonly url: string;
  readonly body: { run_id: string; fn_id: string; qi_id: string; steps: ReadonlyArray<{ op: string; id: string }> };
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

const makeCheckpointMock = (captures: Array<CapturedCheckpoint>) =>
  Layer.effect(
    HttpClient.HttpClient,
    Effect.sync(() =>
      HttpClient.make((request) => {
        if (request.url.includes("/v1/checkpoint/")) {
          captures.push({
            url: request.url,
            body: decodeBody(request.body as never) as CapturedCheckpoint["body"],
          });
          return Effect.succeed(HttpClientResponse.fromWeb(request, new Response("{}", { status: 200 })));
        }
        return Effect.succeed(HttpClientResponse.fromWeb(request, new Response("{}", { status: 200 })));
      }),
    ),
  );

const makeRequest = (options: { readonly fnId: string; readonly eventName: string }) =>
  new Request(`http://localhost/?fnId=${options.fnId}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(
      Protocol.SDKRequestBody.make({
        event: Protocol.InngestEvent.make({ name: options.eventName, data: { v: "x" }, id: "evt", ts: 1 }),
        events: [],
        steps: {},
        ctx: Protocol.SDKRequestContext.make({
          fn_id: options.fnId,
          run_id: "run-1",
          env: "dev",
          step_id: "step",
          attempt: 0,
          max_attempts: 4,
          stack: Protocol.FunctionStack.make({ stack: [], current: 0 }),
          qi_id: "qi-1",
          disable_immediate_execution: false,
          use_api: false,
        }),
        version: 1,
        use_api: false,
      }),
    ),
  });

const MaxRuntimeEvent = InngestEvent.make(
  "ckpt/maxruntime",
  Schema.Struct({
    v: Schema.String,
  }),
);

describe("Checkpoint maxRuntime + maxInterval (spec §10.4.1 #7, §10.1.2)", () => {
  const Fn = InngestFunction.make("ckpt-deadline-fn", {
    trigger: MaxRuntimeEvent,
  });
  const Group = InngestGroup.make(Fn);

  const setup = (handler: Parameters<typeof Group.toLayer>[0]["ckpt-deadline-fn"], checkpointing: unknown) => {
    const captures: Array<CapturedCheckpoint> = [];
    const httpLayer = makeCheckpointMock(captures);
    const HandlersLive = Group.toLayer({ "ckpt-deadline-fn": handler });
    const ClientLive = InngestClient.layer({
      id: "test-app",
      eventKey: "ek",
      mode: "dev",
      signingKey: "signkey-prod-deadbeef",
      checkpointing: checkpointing as never,
    }).pipe(Layer.provide(httpLayer));
    return {
      captures,
      layer: Layer.mergeAll(HandlersLive, ClientLive, httpLayer, FetchHttpClient.layer),
    };
  };

  it.effect(
    "maxRuntime does not force DiscoveryRequest for stepless functions that can still complete",
    () =>
      Effect.gen(function* () {
        let enterCount = 0;
        const { layer } = setup(
          () =>
            Effect.gen(function* () {
              enterCount++;
              yield* Effect.sleep("75 millis");
              return "done";
            }),
          { bufferedSteps: 10, maxRuntime: "25 millis" },
        );
        const { handler, dispose } = InngestGroup.toWebHandler(Group, { layer });
        try {
          const response = yield* Effect.tryPromise(() =>
            handler(makeRequest({ fnId: "ckpt-deadline-fn", eventName: "ckpt/maxruntime" })),
          );
          expect(response.status).toBe(206);
          const body = (yield* Effect.tryPromise(() => response.json())) as Array<{ op: string; data?: unknown }>;

          expect(body).toHaveLength(1);
          expect(body[0]).toMatchObject({ op: "RunComplete", data: "done" });
          expect(enterCount).toBe(1);
        } finally {
          yield* Effect.tryPromise(() => dispose());
        }
      }),
    { timeout: 5_000 },
  );

  it.effect(
    "maxRuntime exceeded plans the next step boundary instead of executing it in-process",
    () =>
      Effect.gen(function* () {
        const { captures, layer } = setup(
          () =>
            Effect.gen(function* () {
              yield* Inngest.run("a", Effect.succeed("A"));
              yield* Effect.sleep("75 millis");
              yield* Inngest.run("b", Effect.succeed("B"));
              return "done";
            }),
          { bufferedSteps: 10, maxRuntime: "25 millis" },
        );
        const { handler, dispose } = InngestGroup.toWebHandler(Group, { layer });
        try {
          const response = yield* Effect.tryPromise(() =>
            handler(makeRequest({ fnId: "ckpt-deadline-fn", eventName: "ckpt/maxruntime" })),
          );
          expect(response.status).toBe(206);
          const body = (yield* Effect.tryPromise(() => response.json())) as Array<{
            op: string;
            id?: string;
            name?: string;
          }>;

          expect(captures).toHaveLength(1);
          expect(captures[0]!.body.steps).toHaveLength(1);
          expect(captures[0]!.body.steps[0]!.op).toBe("StepRun");
          expect(body).toHaveLength(1);
          expect(body[0]).toMatchObject({ op: "StepPlanned", name: "b" });
        } finally {
          yield* Effect.tryPromise(() => dispose());
        }
      }),
    { timeout: 5_000 },
  );

  it.effect(
    "maxInterval triggers time-based flush before bufferedSteps reached",
    () =>
      Effect.gen(function* () {
        // bufferedSteps=10 keeps steps in the buffer; maxInterval=50ms means
        // the *next* bufferStep after the interval elapses triggers a flush.
        // Sequence: step "a" → start interval; sleep 120ms; step "b" sees
        // elapsed > 50ms → flush both.
        const { captures, layer } = setup(
          () =>
            Effect.gen(function* () {
              yield* Inngest.run("a", Effect.succeed("A"));
              yield* Effect.sleep("120 millis");
              yield* Inngest.run("b", Effect.succeed("B"));
              yield* Inngest.run("c", Effect.succeed("C"));
              return "done";
            }),
          { bufferedSteps: 10, maxInterval: "50 millis", maxRuntime: "30 seconds" },
        );
        const { handler, dispose } = InngestGroup.toWebHandler(Group, { layer });
        try {
          const response = yield* Effect.tryPromise(() =>
            handler(makeRequest({ fnId: "ckpt-deadline-fn", eventName: "ckpt/maxruntime" })),
          );
          expect(response.status).toBe(206);
          // maxInterval fired on step "b" → first POST contains steps a+b.
          expect(captures.length).toBe(1);
          expect(captures[0]!.body.steps).toHaveLength(2);
          // Both buffered opcodes are StepRun results with unique SHA-1 hashes.
          const flushedOps = captures[0]!.body.steps;
          expect(flushedOps.every((s) => s.op === "StepRun")).toBe(true);
          expect(flushedOps.every((s) => s.id.length === 40)).toBe(true);
          expect(new Set(flushedOps.map((s) => s.id)).size).toBe(2);
          const body = (yield* Effect.tryPromise(() => response.json())) as Array<{ op: string }>;
          // step "c" remained buffered → drained into terminal 206 with RunComplete.
          expect(body.filter((o) => o.op === "StepRun")).toHaveLength(1);
          expect(body[body.length - 1]!.op).toBe("RunComplete");
        } finally {
          yield* Effect.tryPromise(() => dispose());
        }
      }),
    { timeout: 5_000 },
  );
});
