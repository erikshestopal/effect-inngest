import { HttpClient, HttpClientResponse } from "effect/unstable/http";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import { describe, expect, it } from "@effect/vitest";
import { InngestClient, InngestFunction, InngestGroup, NonRetriableError, InngestEvent } from "../../src/index.js";
import * as Protocol from "../../src/internal/protocol.js";
import { makeTestLayer, makeTestRequest } from "./_helpers.js";

const TestEvent = InngestEvent.make(
  "spec/test.event",
  Schema.Struct({
    value: Schema.String,
  }),
);

const TestFn = InngestFunction.make("spec-test-fn", {
  trigger: { event: TestEvent },
  success: Schema.Struct({ ok: Schema.Boolean }),
});

const TestGroup = InngestGroup.make(TestFn);

describe("Spec Compliance Regressions", () => {
  // Spec §4.1.2: X-Inngest-Req-Version MUST be "2" (execution version).
  it.effect("call success should send X-Inngest-Req-Version: 2", () =>
    Effect.gen(function* () {
      const HandlersLive = TestGroup.toLayer({
        "spec-test-fn": () => Effect.succeed({ ok: true }),
      });

      const { handler, dispose } = InngestGroup.toWebHandler(TestGroup, { layer: makeTestLayer(HandlersLive) });

      try {
        const response = yield* Effect.tryPromise(() =>
          handler(
            makeTestRequest({
              fnId: "spec-test-fn",
              eventName: "spec/test.event",
              eventData: { value: "x" },
              disableImmediateExecution: false,
            }),
          ),
        );

        expect(response.status).toBe(200);
        expect(response.headers.get(Protocol.Headers.RequestVersion)).toBe("2");
      } finally {
        yield* Effect.tryPromise(() => dispose());
      }
    }),
  );

  it.effect("registration request should send native out-of-band sync headers", () =>
    Effect.gen(function* () {
      const capturedHeaders: Array<Record<string, string>> = [];
      const mockHttpClient = Layer.effect(
        HttpClient.HttpClient,
        Effect.sync(() =>
          HttpClient.make((request) => {
            const headers: Record<string, string> = {};
            for (const [k, v] of Object.entries(request.headers)) {
              headers[k.toLowerCase()] = v as string;
            }
            capturedHeaders.push(headers);
            return Effect.succeed(
              HttpClientResponse.fromWeb(
                request,
                new Response(JSON.stringify({ ok: true, modified: true }), {
                  status: 200,
                  headers: { "Content-Type": "application/json" },
                }),
              ),
            );
          }),
        ),
      );

      const clientLayer = InngestClient.layer({ id: "test-app", eventKey: "test-key", checkpointing: false }).pipe(
        Layer.provide(mockHttpClient),
      );
      const handlers = TestGroup.toLayer({
        "spec-test-fn": () => Effect.succeed({ ok: true }),
      });
      const { handler, dispose } = InngestGroup.toWebHandler(TestGroup, {
        layer: Layer.mergeAll(handlers, clientLayer, mockHttpClient),
      });

      try {
        yield* Effect.tryPromise(() =>
          handler(
            new Request("http://localhost:3000/api/inngest", {
              method: "PUT",
              headers: { host: "localhost:3000" },
            }),
          ),
        );

        expect(capturedHeaders).toHaveLength(1);
        expect(capturedHeaders[0]![Protocol.Headers.SDKHandled.toLowerCase()]).toBe("true");
        expect(capturedHeaders[0]![Protocol.Headers.SyncKind.toLowerCase()]).toBe("out_of_band");
        expect(capturedHeaders[0]![Protocol.Headers.Framework.toLowerCase()]).toBeUndefined();
        expect(capturedHeaders[0]![Protocol.Headers.RequestVersion.toLowerCase()]).toBeUndefined();
      } finally {
        yield* Effect.tryPromise(() => dispose());
      }
    }),
  );

  it.effect("unknown function should return 500 with root error payload", () =>
    Effect.gen(function* () {
      const HandlersLive = TestGroup.toLayer({
        "spec-test-fn": () => Effect.succeed({ ok: true }),
      });

      const { handler, dispose } = InngestGroup.toWebHandler(TestGroup, { layer: makeTestLayer(HandlersLive) });

      try {
        const response = yield* Effect.tryPromise(() =>
          handler(
            makeTestRequest({
              fnId: "unknown-fn",
              eventName: "spec/test.event",
              eventData: { value: "x" },
            }),
          ),
        );

        // Spec §4.4.1: unknown function MUST return 500.
        // Spec §4.4.3 pair rule: 500 MUST set X-Inngest-No-Retry: false.
        expect(response.status).toBe(500);
        expect(response.headers.get(Protocol.Headers.NoRetry)).toBe("false");

        const body = (yield* Effect.tryPromise(() => response.json())) as {
          name: string;
          message: string;
        };

        expect(body).toMatchObject({
          name: "FunctionNotFoundError",
          message: "Unknown function: unknown-fn",
        });
      } finally {
        yield* Effect.tryPromise(() => dispose());
      }
    }),
  );

  it.effect("NonRetriableError should return 400 with root error payload", () =>
    Effect.gen(function* () {
      const HandlersLive = TestGroup.toLayer({
        "spec-test-fn": () => Effect.fail(new NonRetriableError({ message: "do not retry" })),
      });

      const { handler, dispose } = InngestGroup.toWebHandler(TestGroup, { layer: makeTestLayer(HandlersLive) });

      try {
        const response = yield* Effect.tryPromise(() =>
          handler(
            makeTestRequest({
              fnId: "spec-test-fn",
              eventName: "spec/test.event",
              eventData: { value: "x" },
            }),
          ),
        );

        expect(response.status).toBe(400);
        expect(response.headers.get(Protocol.Headers.NoRetry)).toBe("true");

        const body = (yield* Effect.tryPromise(() => response.json())) as {
          name: string;
          message: string;
        };

        // Stack is optional per spec §4.4.3 (`{ name, message, stack? }`).
        expect(body).toMatchObject({ name: "NonRetriableError", message: "do not retry" });
      } finally {
        yield* Effect.tryPromise(() => dispose());
      }
    }),
  );

  it.effect("successful sync should return { message, modified }", () =>
    Effect.gen(function* () {
      const mockHttpClient = Layer.effect(
        HttpClient.HttpClient,
        Effect.sync(() =>
          HttpClient.make((request) =>
            Effect.succeed(
              HttpClientResponse.fromWeb(
                request,
                new Response(JSON.stringify({ ok: true, modified: true }), {
                  status: 200,
                  headers: { "Content-Type": "application/json" },
                }),
              ),
            ),
          ),
        ),
      );

      const clientLayer = InngestClient.layer({ id: "test-app", eventKey: "test-key", checkpointing: false }).pipe(
        Layer.provide(mockHttpClient),
      );
      const handlers = TestGroup.toLayer({
        "spec-test-fn": () => Effect.succeed({ ok: true }),
      });

      const { handler, dispose } = InngestGroup.toWebHandler(TestGroup, {
        layer: Layer.mergeAll(handlers, clientLayer, mockHttpClient),
      });

      try {
        const response = yield* Effect.tryPromise(() =>
          handler(
            new Request("http://localhost:3000/api/inngest", {
              method: "PUT",
              headers: { host: "localhost:3000" },
            }),
          ),
        );

        expect(response.status).toBe(200);
        expect((yield* Effect.tryPromise(() => response.json())) as unknown).toEqual({
          message: "Successfully registered",
          modified: true,
        });
      } finally {
        yield* Effect.tryPromise(() => dispose());
      }
    }),
  );

  it.effect("failed sync should return 500 with { message, modified: false }", () =>
    Effect.gen(function* () {
      const failingHttpClient = Layer.effect(
        HttpClient.HttpClient,
        Effect.sync(() =>
          HttpClient.make((_request) =>
            // Intentional global Error to exercise transport-level defect path
            // eslint-disable-next-line effect-inngest/no-global-error-in-effect-fail
            Effect.die(new Error("register transport failed")),
          ),
        ),
      );

      const clientLayer = InngestClient.layer({ id: "test-app", eventKey: "test-key", checkpointing: false }).pipe(
        Layer.provide(failingHttpClient),
      );
      const handlers = TestGroup.toLayer({
        "spec-test-fn": () => Effect.succeed({ ok: true }),
      });

      const { handler, dispose } = InngestGroup.toWebHandler(TestGroup, {
        layer: Layer.mergeAll(handlers, clientLayer, failingHttpClient),
      });

      try {
        const response = yield* Effect.tryPromise(() =>
          handler(
            new Request("http://localhost:3000/api/inngest", {
              method: "PUT",
              headers: { host: "localhost:3000" },
            }),
          ),
        );

        expect(response.status).toBe(500);
        expect((yield* Effect.tryPromise(() => response.json())) as unknown).toEqual({
          message: "register transport failed",
          modified: false,
        });
      } finally {
        yield* Effect.tryPromise(() => dispose());
      }
    }),
  );
});
