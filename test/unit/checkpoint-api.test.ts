import { HttpClient, HttpClientResponse } from "effect/unstable/http";
import * as Crypto from "node:crypto";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schedule from "effect/Schedule";
import { describe, expect, it } from "@effect/vitest";
import { InngestClient } from "../../src/index.js";
import { CheckpointApiError } from "../../src/internal/checkpoint.js";
import * as Protocol from "../../src/internal/protocol.js";

// Reach the test-only factory via its globally-registered symbol. Not a
// public API — the factory isn't a named export, so it's not in
// `InngestClient.*` autocomplete.
const TEST_FACTORY_KEY = Symbol.for("effect-inngest/internal/test-retry-schedule-factory");
const layerWithRetrySchedule = (InngestClient.InngestClient as unknown as Record<symbol, unknown>)[
  TEST_FACTORY_KEY
] as (
  config: Parameters<typeof InngestClient.layer>[0],
  retrySchedule: Schedule.Schedule<unknown, CheckpointApiError>,
) => Layer.Layer<InngestClient.InngestClient, never, HttpClient.HttpClient>;

// Zero-delay retry schedule for tests; production uses exponential backoff.
const instantRetry: Schedule.Schedule<unknown, CheckpointApiError> = Schedule.recurs(5).pipe(
  Schedule.while(
    (m: Schedule.Metadata<unknown, CheckpointApiError>) => m.input.status === undefined || m.input.status >= 500,
  ),
);

interface CapturedReq {
  readonly method: string;
  readonly url: string;
  readonly headers: Record<string, string>;
  readonly body: unknown;
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

const collectHeaders = (request: { headers: Record<string, string> }): Record<string, string> => ({
  ...request.headers,
});

/**
 * Make a configurable mock HttpClient that captures every request and returns
 * the response chosen by `responder` (called with the captured request count
 * BEFORE the call is appended).
 */
const makeMockHttpClient = (
  captures: Array<CapturedReq>,
  responder: (callIndex: number, req: CapturedReq) => Response,
) =>
  Layer.effect(
    HttpClient.HttpClient,
    Effect.sync(() =>
      HttpClient.make((request) => {
        const captured: CapturedReq = {
          method: request.method,
          url: request.url,
          headers: collectHeaders(request),
          body: decodeBody(request.body as never),
        };
        const idx = captures.length;
        captures.push(captured);
        return Effect.succeed(HttpClientResponse.fromWeb(request, responder(idx, captured)));
      }),
    ),
  );

const sha256Hex = (input: string): string => Crypto.createHash("sha256").update(input).digest("hex");

const okResponse = () => new Response("{}", { status: 200, headers: { "Content-Type": "application/json" } });

const sampleSteps: ReadonlyArray<typeof Protocol.GeneratorOpcode.Type> = [
  Protocol.stepRun({ id: "a", name: "a", hash: "0".repeat(40) }, { value: 1 }),
];

describe("InngestClient.checkpointAsync (spec §10.3.1)", () => {
  it.effect("posts correct body shape to async endpoint", () =>
    Effect.gen(function* () {
      const captures: Array<CapturedReq> = [];
      const httpLayer = makeMockHttpClient(captures, () => okResponse());
      const clientLayer = InngestClient.layer({
        id: "app",
        signingKey: "signkey-prod-abc123",
        apiBaseUrl: "https://api.inngest.com",
      }).pipe(Layer.provide(httpLayer));

      yield* InngestClient.InngestClient.use((client) =>
        client.checkpointAsync({ runId: "run-1", fnId: "fn-1", qiId: "qi-1", steps: sampleSteps }),
      ).pipe(Effect.provide(Layer.mergeAll(clientLayer, httpLayer)));

      expect(captures).toHaveLength(1);
      const req = captures[0]!;
      expect(req.method).toBe("POST");
      expect(req.url).toBe("https://api.inngest.com/v1/checkpoint/run-1/async");
      const body = req.body as { run_id: string; fn_id: string; qi_id: string; steps: unknown[]; ts: number };
      expect(body.run_id).toBe("run-1");
      expect(body.fn_id).toBe("fn-1");
      expect(body.qi_id).toBe("qi-1");
      expect(body.steps).toHaveLength(1);
      expect(typeof body.ts).toBe("number");
    }),
  );

  it.effect("posts to /v1/checkpoint/{runId}/async", () =>
    Effect.gen(function* () {
      const captures: Array<CapturedReq> = [];
      const httpLayer = makeMockHttpClient(captures, () => okResponse());
      const clientLayer = InngestClient.layer({
        id: "app",
        signingKey: "signkey-prod-deadbeef",
        apiBaseUrl: "https://api.example/",
      }).pipe(Layer.provide(httpLayer));

      yield* InngestClient.InngestClient.use((c) =>
        c.checkpointAsync({ runId: "abc", fnId: "fn", qiId: "qi", steps: sampleSteps }),
      ).pipe(Effect.provide(Layer.mergeAll(clientLayer, httpLayer)));

      expect(captures[0]!.url).toBe("https://api.example/v1/checkpoint/abc/async");
    }),
  );

  it.effect("sends bearer auth and native checkpoint headers", () =>
    Effect.gen(function* () {
      const captures: Array<CapturedReq> = [];
      const httpLayer = makeMockHttpClient(captures, () => okResponse());
      const signingKey = "signkey-prod-deadbeef";
      const expectedHash = sha256Hex("deadbeef");
      const clientLayer = InngestClient.layer({
        id: "app",
        signingKey,
        apiBaseUrl: "https://api.inngest.com",
        env: "production",
      }).pipe(Layer.provide(httpLayer));

      yield* InngestClient.InngestClient.use((c) =>
        c.checkpointAsync({ runId: "r", fnId: "f", qiId: "q", steps: sampleSteps }),
      ).pipe(Effect.provide(Layer.mergeAll(clientLayer, httpLayer)));

      const headers = captures[0]!.headers;
      expect(headers["authorization"]).toBe(`Bearer ${expectedHash}`);
      expect(headers["x-inngest-sdk"]).toBeUndefined();
      expect(headers["x-inngest-req-version"]).toBeUndefined();
      expect(headers["x-inngest-env"]).toBe("production");
      expect(headers["content-type"]).toContain("application/json");
    }),
  );

  it.effect("retries 5xx responses with exponential backoff", () =>
    Effect.gen(function* () {
      const captures: Array<CapturedReq> = [];
      const httpLayer = makeMockHttpClient(captures, (idx) => {
        if (idx < 3) {
          return new Response("oops", { status: 500 });
        }
        return okResponse();
      });
      const clientLayer = layerWithRetrySchedule({ id: "app", signingKey: "signkey-prod-abc" }, instantRetry).pipe(
        Layer.provide(httpLayer),
      );

      yield* InngestClient.InngestClient.use((c) =>
        c.checkpointAsync({ runId: "r", fnId: "f", qiId: "q", steps: sampleSteps }),
      ).pipe(Effect.provide(Layer.mergeAll(clientLayer, httpLayer)));

      // 3 failures + 1 success = 4 attempts
      expect(captures.length).toBe(4);
    }),
  );

  it.effect("eventually fails with CheckpointApiError on persistent 5xx", () =>
    Effect.gen(function* () {
      const captures: Array<CapturedReq> = [];
      const httpLayer = makeMockHttpClient(captures, () => new Response("nope", { status: 503 }));
      const clientLayer = layerWithRetrySchedule({ id: "app", signingKey: "signkey-prod-abc" }, instantRetry).pipe(
        Layer.provide(httpLayer),
      );

      const result = yield* Effect.exit(
        InngestClient.InngestClient.use((c) =>
          c.checkpointAsync({ runId: "r", fnId: "f", qiId: "q", steps: sampleSteps }),
        ).pipe(Effect.provide(Layer.mergeAll(clientLayer, httpLayer))),
      );

      expect(result._tag).toBe("Failure");
      // 1 initial + 5 retries = 6 attempts
      expect(captures.length).toBe(6);
    }),
  );

  it.effect("does not retry on 4xx other than 401", () =>
    Effect.gen(function* () {
      const captures: Array<CapturedReq> = [];
      const httpLayer = makeMockHttpClient(captures, () => new Response("bad", { status: 400 }));
      const clientLayer = InngestClient.layer({
        id: "app",
        signingKey: "signkey-prod-abc",
      }).pipe(Layer.provide(httpLayer));

      const result = yield* Effect.exit(
        InngestClient.InngestClient.use((c) =>
          c.checkpointAsync({ runId: "r", fnId: "f", qiId: "q", steps: sampleSteps }),
        ).pipe(Effect.provide(Layer.mergeAll(clientLayer, httpLayer))),
      );

      expect(result._tag).toBe("Failure");
      expect(captures.length).toBe(1);
    }),
  );

  it.effect("401 triggers fallback signing key + Ref flip", () =>
    Effect.gen(function* () {
      const captures: Array<CapturedReq> = [];
      const primary = "signkey-prod-primary123";
      const fallback = "signkey-prod-fallback456";
      const primaryHash = sha256Hex("primary123");
      const fallbackHash = sha256Hex("fallback456");

      // First call with primary → 401. Second (fallback retry) → 200.
      // Then a SECOND checkpoint request: should use fallback first → 200.
      const httpLayer = makeMockHttpClient(captures, (_idx, req) => {
        const auth = req.headers["authorization"] ?? "";
        if (auth === `Bearer ${primaryHash}`) {
          return new Response("nope", { status: 401 });
        }
        return okResponse();
      });

      const clientLayer = InngestClient.layer({
        id: "app",
        signingKey: primary,
        signingKeyFallback: fallback,
      }).pipe(Layer.provide(httpLayer));

      yield* Effect.gen(function* () {
        yield* InngestClient.InngestClient.use((c) =>
          c.checkpointAsync({ runId: "r1", fnId: "f", qiId: "q", steps: sampleSteps }),
        );
        yield* InngestClient.InngestClient.use((c) =>
          c.checkpointAsync({ runId: "r2", fnId: "f", qiId: "q", steps: sampleSteps }),
        );
      }).pipe(Effect.provide(Layer.mergeAll(clientLayer, httpLayer)));

      // Call 1: primary 401 → fallback 200 (2 captures)
      // Call 2: fallback 200 (1 capture) — no longer tries primary
      expect(captures.length).toBe(3);
      expect(captures[0]!.headers["authorization"]).toBe(`Bearer ${primaryHash}`);
      expect(captures[1]!.headers["authorization"]).toBe(`Bearer ${fallbackHash}`);
      expect(captures[2]!.headers["authorization"]).toBe(`Bearer ${fallbackHash}`);
    }),
  );

  it.effect("fails with CheckpointApiError when no signing key is configured in cloud mode", () =>
    Effect.gen(function* () {
      const captures: Array<CapturedReq> = [];
      const httpLayer = makeMockHttpClient(captures, () => okResponse());
      const clientLayer = InngestClient.layer({ id: "app", mode: "cloud" }).pipe(Layer.provide(httpLayer));

      const result = yield* Effect.exit(
        InngestClient.InngestClient.use((c) =>
          c.checkpointAsync({ runId: "r", fnId: "f", qiId: "q", steps: sampleSteps }),
        ).pipe(Effect.provide(Layer.mergeAll(clientLayer, httpLayer))),
      );

      expect(result._tag).toBe("Failure");
      expect(captures.length).toBe(0);
    }),
  );

  it.effect("uses an empty bearer token for local dev checkpointing without a signing key", () =>
    Effect.gen(function* () {
      const captures: Array<CapturedReq> = [];
      const httpLayer = makeMockHttpClient(captures, () => okResponse());
      const clientLayer = InngestClient.layer({ id: "app", mode: "dev" }).pipe(Layer.provide(httpLayer));

      yield* InngestClient.InngestClient.use((c) =>
        c.checkpointAsync({ runId: "r", fnId: "f", qiId: "q", steps: sampleSteps }),
      ).pipe(Effect.provide(Layer.mergeAll(clientLayer, httpLayer)));

      expect(captures).toHaveLength(1);
      expect(captures[0]!.headers.authorization).toBe("Bearer ");
    }),
  );
});

// Re-export so the file is treated as a module by tsgo
export {};
const _unused = Option.none();
void _unused;
