/**
 * @module test/FunctionGroup.http.test
 * @description HTTP behavioral tests for InngestGroup.toHttpApp() and toWebHandler()
 */

import { Effect, Layer, Schema } from "effect";
import { FetchHttpClient, HttpClient } from "effect/unstable/http";
import { describe, expect, it } from "@effect/vitest";

import { InngestFunction, InngestGroup, InngestClient, InngestEvent } from "../../src/index.js";
import * as Protocol from "../../src/internal/protocol.js";
import { makeTestLayer, makeTestRequest } from "./_helpers.js";

// Test Fixtures

const TestEvent = InngestEvent.make(
  "test/event",
  Schema.Struct({
    userId: Schema.String,
  }),
);

const TestOther = InngestEvent.make(
  "test/other",
  Schema.Struct({
    orderId: Schema.String,
  }),
);

const testFunction = InngestFunction.make("test-fn", {
  trigger: { event: TestEvent },
});

const testFunction2 = InngestFunction.make("test-fn-2", {
  trigger: { event: TestOther },
});

const testGroup = InngestGroup.make(testFunction, testFunction2);

// Handler layers for both functions
const HandlersLayer = testGroup.toLayer({
  "test-fn": ({ event }) => Effect.succeed({ received: event.data.userId }),
  "test-fn-2": ({ event }) => Effect.succeed({ received: event.data.orderId }),
});

// Dev mode client for tests that need to check dev-specific behavior.
// Checkpointing disabled so existing assertions about classic-mode wire
// shape (200 + raw body) remain valid; checkpointing has dedicated tests.
const DevTestClient = InngestClient.layer({
  id: "test-app",
  eventKey: "test-key",
  mode: "dev",
  checkpointing: false,
}).pipe(Layer.provide(FetchHttpClient.layer));

// Combined test layer with both handlers and dev mode client
const TestLayer = Layer.mergeAll(HandlersLayer, DevTestClient, FetchHttpClient.layer);

// Helper to make requests for tests

const makeRequestBody = (options: { fnId: string; eventName: string; eventData: Record<string, unknown> }) =>
  Protocol.SDKRequestBody.make({
    event: Protocol.InngestEvent.make({
      name: options.eventName,
      data: options.eventData,
      id: "evt_1",
      ts: Date.now(),
    }),
    events: [],
    steps: {},
    ctx: Protocol.SDKRequestContext.make({
      fn_id: options.fnId,
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
  });

// GET / - Introspection Tests

// Helper to create requests with Host header
const makeRequest = (method: string, url = "http://localhost:9999/", body?: string) =>
  new Request(url, {
    method,
    body,
    headers: {
      Host: "localhost:9999",
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
  });

describe("InngestGroup.toWebHandler GET /", () => {
  it.effect("returns introspection response with function count", () =>
    Effect.gen(function* () {
      const { handler, dispose } = InngestGroup.toWebHandler(testGroup, { layer: TestLayer });
      try {
        const response = yield* Effect.tryPromise(() => handler(makeRequest("GET")));
        expect(response.status).toBe(200);

        const body = yield* Effect.tryPromise(() => response.json());
        expect(body).toMatchObject({
          function_count: 2,
          has_event_key: true,
          mode: "dev",
          schema_version: "2024-05-24",
        });
      } finally {
        yield* Effect.tryPromise(() => dispose());
      }
    }),
  );

  it.effect("returns schema_version in introspection", () =>
    Effect.gen(function* () {
      const { handler, dispose } = InngestGroup.toWebHandler(testGroup, { layer: TestLayer });
      try {
        const response = yield* Effect.tryPromise(() => handler(makeRequest("GET")));
        const body = yield* Effect.tryPromise(() => response.json() as Promise<{ schema_version?: string }>);

        expect(body.schema_version).toBe("2024-05-24");
      } finally {
        yield* Effect.tryPromise(() => dispose());
      }
    }),
  );

  it.effect("returns SDK headers", () =>
    Effect.gen(function* () {
      const { handler, dispose } = InngestGroup.toWebHandler(testGroup, { layer: TestLayer });
      try {
        const response = yield* Effect.tryPromise(() => handler(makeRequest("GET")));

        expect(response.headers.get("content-type")).toBe("application/json");
        expect(response.headers.get(Protocol.Headers.SDK)).toMatch(/effect-inngest:v/);
      } finally {
        yield* Effect.tryPromise(() => dispose());
      }
    }),
  );
});

// PUT / - Registration Tests

describe("InngestGroup.toWebHandler PUT /", () => {
  it.effect("triggers registration and returns failure body on transport error", () =>
    Effect.gen(function* () {
      // Inject a failing HttpClient so this test is deterministic regardless
      // of whether a real Inngest dev server is running locally.
      const FailingHttp = Layer.effect(
        HttpClient.HttpClient,
        Effect.sync(() => HttpClient.make(() => Effect.die("transport-down"))),
      );
      const FailingClient = InngestClient.layer({
        id: "test-app",
        eventKey: "test-key",
        mode: "dev",
        checkpointing: false,
      }).pipe(Layer.provide(FailingHttp));
      const FailingLayer = Layer.mergeAll(HandlersLayer, FailingClient, FailingHttp);

      const { handler, dispose } = InngestGroup.toWebHandler(testGroup, { layer: FailingLayer });
      try {
        const response = yield* Effect.tryPromise(() => handler(makeRequest("PUT")));

        // Transport failure → handler returns spec-compliant §4.3.3 body
        // `{ message, modified: false }` with 500.
        expect(response.status).toBe(500);
        const body = (yield* Effect.tryPromise(() => response.json())) as { modified?: boolean };
        expect(body.modified).toBe(false);
      } finally {
        yield* Effect.tryPromise(() => dispose());
      }
    }),
  );
});

// POST / - Execution Tests

describe("InngestGroup.toWebHandler POST /", () => {
  it.effect("returns error when fnId is missing", () =>
    Effect.gen(function* () {
      const { handler, dispose } = InngestGroup.toWebHandler(testGroup, { layer: TestLayer });
      try {
        const requestBody = makeRequestBody({
          fnId: "test-fn",
          eventName: "test/event",
          eventData: { userId: "user-1" },
        });

        const response = yield* Effect.tryPromise(() =>
          handler(makeRequest("POST", "http://localhost:9999/", JSON.stringify(requestBody))),
        );

        expect([400, 500]).toContain(response.status);
        const body = yield* Effect.tryPromise(() => response.json() as Promise<{ error?: string }>);
        expect(body.error).toBeDefined();
      } finally {
        yield* Effect.tryPromise(() => dispose());
      }
    }),
  );

  it.effect("returns error when function not found", () =>
    Effect.gen(function* () {
      const { handler, dispose } = InngestGroup.toWebHandler(testGroup, { layer: TestLayer });
      try {
        const requestBody = makeRequestBody({
          fnId: "unknown-fn",
          eventName: "test/event",
          eventData: { userId: "user-1" },
        });

        const response = yield* Effect.tryPromise(() =>
          handler(makeRequest("POST", "http://localhost:9999/?fnId=unknown-fn", JSON.stringify(requestBody))),
        );

        expect([404, 500]).toContain(response.status);
      } finally {
        yield* Effect.tryPromise(() => dispose());
      }
    }),
  );

  it.effect("returns error when handler not found", () =>
    Effect.gen(function* () {
      // Create a group with a function that has no handler registered
      const NoHandlerEvent = InngestEvent.make(
        "no-handler/event",
        Schema.Struct({
          id: Schema.String,
        }),
      );
      const noHandlerFn = InngestFunction.make("no-handler-fn", {
        trigger: { event: NoHandlerEvent },
      });
      const noHandlerGroup = InngestGroup.make(noHandlerFn);

      // Layer WITHOUT handler for no-handler-fn - cast to bypass type check since we're testing runtime error
      const NoHandlerLayer = Layer.mergeAll(DevTestClient, FetchHttpClient.layer) as never;
      const { handler, dispose } = InngestGroup.toWebHandler(noHandlerGroup, { layer: NoHandlerLayer });

      try {
        const requestBody = makeRequestBody({
          fnId: "no-handler-fn",
          eventName: "no-handler/event",
          eventData: { id: "test-1" },
        });

        const response = yield* Effect.tryPromise(() =>
          handler(makeRequest("POST", "http://localhost:9999/?fnId=no-handler-fn", JSON.stringify(requestBody))),
        );

        expect([404, 500]).toContain(response.status);
      } finally {
        yield* Effect.tryPromise(() => dispose());
      }
    }),
  );

  it.effect("executes function and returns result", () =>
    Effect.gen(function* () {
      const { handler, dispose } = InngestGroup.toWebHandler(testGroup, { layer: TestLayer });
      try {
        const webRequest = makeTestRequest({
          fnId: "test-fn",
          eventName: "test/event",
          eventData: { userId: "user-1" },
          disableImmediateExecution: false,
        });

        const response = yield* Effect.tryPromise(() => handler(webRequest));

        expect(response.status).toBe(200);
        const body = yield* Effect.tryPromise(() => response.json());
        expect(body).toMatchObject({ received: "user-1" });
      } finally {
        yield* Effect.tryPromise(() => dispose());
      }
    }),
  );

  it.effect("parses stepId from query params", () =>
    Effect.gen(function* () {
      const { handler, dispose } = InngestGroup.toWebHandler(testGroup, { layer: TestLayer });
      try {
        const requestBody = makeRequestBody({
          fnId: "test-fn",
          eventName: "test/event",
          eventData: { userId: "user-1" },
        });

        const response = yield* Effect.tryPromise(() =>
          handler(
            makeRequest("POST", "http://localhost:9999/?fnId=test-fn&stepId=custom-step", JSON.stringify(requestBody)),
          ),
        );

        // Should work with custom stepId
        expect(response.status).toBe(200);
      } finally {
        yield* Effect.tryPromise(() => dispose());
      }
    }),
  );

  it.effect("returns 500 for invalid JSON body", () =>
    Effect.gen(function* () {
      const { handler, dispose } = InngestGroup.toWebHandler(testGroup, { layer: TestLayer });
      try {
        const response = yield* Effect.tryPromise(() =>
          handler(makeRequest("POST", "http://localhost:9999/?fnId=test-fn", "not valid json")),
        );

        expect(response.status).toBe(500);
        const body = yield* Effect.tryPromise(() => response.json() as Promise<{ error: string }>);
        expect(body.error).toBe("Internal server error");
      } finally {
        yield* Effect.tryPromise(() => dispose());
      }
    }),
  );

  it.effect("returns 500 for invalid request body schema", () =>
    Effect.gen(function* () {
      const { handler, dispose } = InngestGroup.toWebHandler(testGroup, { layer: TestLayer });
      try {
        const response = yield* Effect.tryPromise(() =>
          handler(makeRequest("POST", "http://localhost:9999/?fnId=test-fn", JSON.stringify({ invalid: "body" }))),
        );

        expect(response.status).toBe(500);
      } finally {
        yield* Effect.tryPromise(() => dispose());
      }
    }),
  );
});

// Method Not Allowed

describe("InngestGroup.toWebHandler unsupported methods", () => {
  it.effect("returns 405 for DELETE", () =>
    Effect.gen(function* () {
      const { handler, dispose } = InngestGroup.toWebHandler(testGroup, { layer: TestLayer });
      try {
        const response = yield* Effect.tryPromise(() => handler(makeRequest("DELETE")));

        expect(response.status).toBe(405);
        const body = yield* Effect.tryPromise(() => response.json());
        expect(body).toMatchObject({ error: "Method DELETE not allowed" });
      } finally {
        yield* Effect.tryPromise(() => dispose());
      }
    }),
  );

  it.effect("returns 405 for PATCH", () =>
    Effect.gen(function* () {
      const { handler, dispose } = InngestGroup.toWebHandler(testGroup, { layer: TestLayer });
      try {
        const response = yield* Effect.tryPromise(() => handler(makeRequest("PATCH")));

        expect(response.status).toBe(405);
      } finally {
        yield* Effect.tryPromise(() => dispose());
      }
    }),
  );
});

// toWebHandler lifecycle

describe("InngestGroup.toWebHandler lifecycle", () => {
  it("returns handler and dispose functions", async () => {
    const { handler, dispose } = InngestGroup.toWebHandler(testGroup, { layer: TestLayer });

    expect(typeof handler).toBe("function");
    expect(typeof dispose).toBe("function");

    await dispose();
  });

  it("dispose cleans up runtime", async () => {
    const { handler, dispose } = InngestGroup.toWebHandler(testGroup, { layer: TestLayer });

    const response = await handler(makeRequest("GET"));
    expect(response.status).toBe(200);

    await dispose();
  });
});

// httpApiGroup and httpApiGroupLayer (for HttpApiBuilder integration)

// Note: v2 API uses InngestHttpApi module for HttpApiBuilder integration
// See InngestHttpApi.InngestApiGroup and InngestHttpApi.layerGroup
