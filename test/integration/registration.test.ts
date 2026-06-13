import { HttpClient, HttpClientResponse } from "effect/unstable/http";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { describe, expect, it } from "@effect/vitest";
import { InngestFunction, InngestGroup, InngestClient } from "../../src/index.js";

// TB-007: Registration
//
// Goal: PUT request triggers SDK to POST registration to Inngest server.
//
// Convention established here:
// - PUT / builds RegisterRequest from FunctionGroup functions
// - SDK POSTs to /fn/register with function definitions
// - RegisterRequest contains: v, url, deployType, sdk, appName, functions
// - SDKFunction contains: id, name, triggers, steps

/**
 * Extract JSON from HttpBody (Uint8Array variant).
 * The body is JSON-encoded bytes from HttpClientRequest.schemaBodyJson.
 * Returns Option.none() if body is not Uint8Array or cannot be parsed.
 */
const extractBodyJson = (body: { readonly _tag: string; readonly body?: Uint8Array }): Option.Option<unknown> => {
  if (body._tag === "Uint8Array" && body.body) {
    try {
      const text = new TextDecoder().decode(body.body);
      return Option.some(JSON.parse(text));
    } catch {
      return Option.none();
    }
  }
  return Option.none();
};

/**
 * Create a mock HttpClient layer that captures requests for verification.
 */
const makeMockHttpClient = (
  captureRequest: (method: string, url: string, body: Option.Option<unknown>) => void,
  // Match the wire shape from the Inngest executor per spec §4.3.4:
  // success → `{ ok: true, modified?: boolean }`, failure → `{ error?: string }`.
  responseBody: { ok?: boolean; modified?: boolean; error?: string } = { ok: true, modified: true },
) =>
  Layer.effect(
    HttpClient.HttpClient,
    Effect.sync(() =>
      HttpClient.make((request) => {
        const bodyOption = extractBodyJson(request.body as { readonly _tag: string; readonly body?: Uint8Array });
        captureRequest(request.method, request.url, bodyOption);

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

/** Network error type for testing failure scenarios */
class TestNetworkError extends Schema.TaggedErrorClass<TestNetworkError>()("TestNetworkError", {
  message: Schema.String,
}) {}

/**
 * Create a mock HttpClient that always fails with a network error.
 * Returns error via catchAll in the registration handler.
 */
const makeFailingHttpClient = () =>
  Layer.effect(
    HttpClient.HttpClient,
    Effect.sync(() =>
      HttpClient.make((_request) =>
        // Return an effect that dies with a tagged error - this gets caught by catchAllCause
        Effect.die(TestNetworkError.make({ message: "Network error" })),
      ),
    ),
  );

class UserCreated extends Schema.TaggedClass<UserCreated>()("user/created", {
  userId: Schema.String,
  email: Schema.String,
}) {}

class OrderPlaced extends Schema.TaggedClass<OrderPlaced>()("order/placed", {
  orderId: Schema.String,
  total: Schema.Number,
}) {}

describe("TB-007: Registration", () => {
  const ProcessUser = InngestFunction.make("process-user", {
    trigger: { event: UserCreated },
    success: Schema.Void,
  });

  const Group = InngestGroup.make(ProcessUser);

  const HandlersLive = Group.toLayer({
    "process-user": ({ event }) => Effect.succeed({ processed: event.userId }),
  });

  it("PUT / triggers registration POST to Inngest", async () => {
    const capturedRequests: Array<{ method: string; url: string; body: Option.Option<unknown> }> = [];

    const mockHttpClient = makeMockHttpClient((method, url, body) => capturedRequests.push({ method, url, body }));

    const clientLayer = InngestClient.layer({
      id: "test-app",
      eventKey: "test-key",
      apiBaseUrl: "https://api.inngest.com",
    }).pipe(Layer.provide(mockHttpClient));

    // Layer must provide: handlers, client, and HttpClient for registration
    const fullLayer = Layer.mergeAll(HandlersLive, clientLayer, mockHttpClient);

    const { handler, dispose } = InngestGroup.toWebHandler(Group, { layer: fullLayer });

    try {
      const response = await handler(
        new Request("http://localhost:3000/api/inngest", {
          method: "PUT",
          headers: { host: "localhost:3000" },
        }),
      );

      expect(response.status).toBe(200);

      // Verify registration was sent
      expect(capturedRequests).toHaveLength(1);
      expect(capturedRequests[0]!.method).toBe("POST");
      expect(capturedRequests[0]!.url).toContain("/fn/register");

      const body = Option.getOrNull(capturedRequests[0]!.body);
      expect(body).toBeTruthy();
      expect(body).toMatchObject({
        v: "0.1",
        url: expect.stringContaining("localhost:3000"),
        deployType: "ping",
        sdk: expect.stringContaining("effect-inngest"),
        appName: "test-app",
        functions: [
          {
            id: "test-app-process-user",
            name: "process-user",
            triggers: [{ event: "user/created" }],
            steps: {
              step: {
                id: "step",
                name: "step",
                runtime: {
                  type: "http",
                  url: expect.stringContaining("localhost:3000"),
                },
              },
            },
          },
        ],
      });
      expect(body).not.toHaveProperty("framework");
    } finally {
      await dispose();
    }
  });

  it("includes expression field for triggers with if condition", async () => {
    const ProcessOrder = InngestFunction.make("process-order", {
      trigger: { event: OrderPlaced, if: "event.data.total > 100" },
      success: Schema.Void,
    });

    const OrderGroup = InngestGroup.make(ProcessOrder);

    const OrderHandlers = OrderGroup.toLayer({
      "process-order": () => Effect.succeed({ processed: true }),
    });

    const capturedRequests: Array<{ body: Option.Option<unknown> }> = [];

    const mockHttpClient = makeMockHttpClient((_method, _url, body) => capturedRequests.push({ body }), {
      ok: true,
      modified: true,
    });

    const clientLayer = InngestClient.layer({
      id: "order-app",
      eventKey: "test-key",
    }).pipe(Layer.provide(mockHttpClient));

    const fullLayer = Layer.mergeAll(OrderHandlers, clientLayer, mockHttpClient);

    const { handler, dispose } = InngestGroup.toWebHandler(OrderGroup, { layer: fullLayer });

    try {
      const response = await handler(
        new Request("http://localhost:3000/api/inngest", {
          method: "PUT",
          headers: { host: "localhost:3000" },
        }),
      );

      expect(response.status).toBe(200);
      expect(capturedRequests).toHaveLength(1);

      const body = Option.getOrNull(capturedRequests[0]!.body) as {
        functions: Array<{ triggers: Array<{ event: string; expression?: string }> }>;
      } | null;
      expect(body).toBeTruthy();
      expect(body!.functions[0]!.triggers[0]).toEqual({
        event: "order/placed",
        expression: "event.data.total > 100",
      });
    } finally {
      await dispose();
    }
  });

  it("step URL includes fnId and stepId query parameters", async () => {
    // BUG FIX: The step runtime URL must include fnId and stepId query params
    // so Inngest can route execution requests to the correct function.
    // Without these params, Inngest sends POST without fnId, causing "Missing or invalid fnId" errors.
    const capturedRequests: Array<{ body: Option.Option<unknown> }> = [];

    const mockHttpClient = makeMockHttpClient((_method, _url, body) => capturedRequests.push({ body }));

    const clientLayer = InngestClient.layer({
      id: "test-app",
      eventKey: "test-key",
    }).pipe(Layer.provide(mockHttpClient));

    const fullLayer = Layer.mergeAll(HandlersLive, clientLayer, mockHttpClient);

    const { handler, dispose } = InngestGroup.toWebHandler(Group, { layer: fullLayer });

    try {
      await handler(
        new Request("http://localhost:3000/api/inngest", {
          method: "PUT",
          headers: { host: "localhost:3000" },
        }),
      );

      expect(capturedRequests).toHaveLength(1);

      const body = Option.getOrNull(capturedRequests[0]!.body) as {
        functions: Array<{ id: string; steps: { step: { runtime: { url: string } } } }>;
      } | null;
      expect(body).toBeTruthy();

      const stepUrl = new URL(body!.functions[0]!.steps.step.runtime.url);
      expect(stepUrl.searchParams.get("fnId")).toBe("test-app-process-user");
      expect(stepUrl.searchParams.get("stepId")).toBe("step");
    } finally {
      await dispose();
    }
  });

  it("includes checkpoint block for function with checkpointing: true (spec §10.1.1)", async () => {
    const CheckpointedFn = InngestFunction.make("checkpointed-fn", {
      trigger: { event: UserCreated },
      success: Schema.Void,
      checkpointing: true,
    });
    const CheckpointedGroup = InngestGroup.make(CheckpointedFn);
    const CheckpointedHandlers = CheckpointedGroup.toLayer({
      "checkpointed-fn": () => Effect.succeed({ processed: true }),
    });

    const capturedRequests: Array<{ body: Option.Option<unknown> }> = [];
    const mockHttpClient = makeMockHttpClient((_method, _url, body) => capturedRequests.push({ body }));

    const clientLayer = InngestClient.layer({
      id: "ckpt-app",
      eventKey: "test-key",
    }).pipe(Layer.provide(mockHttpClient));

    const fullLayer = Layer.mergeAll(CheckpointedHandlers, clientLayer, mockHttpClient);
    const { handler, dispose } = InngestGroup.toWebHandler(CheckpointedGroup, { layer: fullLayer });

    try {
      await handler(
        new Request("http://localhost:3000/api/inngest", {
          method: "PUT",
          headers: { host: "localhost:3000" },
        }),
      );

      const body = Option.getOrNull(capturedRequests[0]!.body) as {
        functions: Array<{
          checkpoint?: { batch_steps: number; batch_interval: string; max_runtime: string };
        }>;
      } | null;
      expect(body).toBeTruthy();
      expect(body!.functions[0]!.checkpoint).toEqual({
        batch_steps: 1,
        batch_interval: "0s",
        max_runtime: "10s",
      });
    } finally {
      await dispose();
    }
  });

  it("includes custom checkpoint block for function with tuned options", async () => {
    const CheckpointedFn = InngestFunction.make("tuned-ckpt-fn", {
      trigger: { event: UserCreated },
      success: Schema.Void,
      checkpointing: { bufferedSteps: 5, maxInterval: "2 seconds", maxRuntime: "1 minute" },
    });
    const CheckpointedGroup = InngestGroup.make(CheckpointedFn);
    const CheckpointedHandlers = CheckpointedGroup.toLayer({
      "tuned-ckpt-fn": () => Effect.succeed({ processed: true }),
    });

    const capturedRequests: Array<{ body: Option.Option<unknown> }> = [];
    const mockHttpClient = makeMockHttpClient((_method, _url, body) => capturedRequests.push({ body }));

    const clientLayer = InngestClient.layer({
      id: "ckpt-app",
      eventKey: "test-key",
    }).pipe(Layer.provide(mockHttpClient));

    const fullLayer = Layer.mergeAll(CheckpointedHandlers, clientLayer, mockHttpClient);
    const { handler, dispose } = InngestGroup.toWebHandler(CheckpointedGroup, { layer: fullLayer });

    try {
      await handler(
        new Request("http://localhost:3000/api/inngest", {
          method: "PUT",
          headers: { host: "localhost:3000" },
        }),
      );

      const body = Option.getOrNull(capturedRequests[0]!.body) as {
        functions: Array<{
          checkpoint?: { batch_steps: number; batch_interval: string; max_runtime: string };
        }>;
      } | null;
      expect(body).toBeTruthy();
      expect(body!.functions[0]!.checkpoint).toEqual({
        batch_steps: 5,
        batch_interval: "2s",
        max_runtime: "1m",
      });
    } finally {
      await dispose();
    }
  });

  it("omits checkpoint block for function with checkpointing: false (opt-out)", async () => {
    const OptOutFn = InngestFunction.make("optout-ckpt-fn", {
      trigger: { event: UserCreated },
      success: Schema.Void,
      checkpointing: false,
    });
    const OptOutGroup = InngestGroup.make(OptOutFn);
    const OptOutHandlers = OptOutGroup.toLayer({
      "optout-ckpt-fn": () => Effect.succeed({ processed: true }),
    });

    const capturedRequests: Array<{ body: Option.Option<unknown> }> = [];
    const mockHttpClient = makeMockHttpClient((_method, _url, body) => capturedRequests.push({ body }));

    const clientLayer = InngestClient.layer({
      id: "ckpt-app",
      eventKey: "test-key",
    }).pipe(Layer.provide(mockHttpClient));

    const fullLayer = Layer.mergeAll(OptOutHandlers, clientLayer, mockHttpClient);
    const { handler, dispose } = InngestGroup.toWebHandler(OptOutGroup, { layer: fullLayer });

    try {
      await handler(
        new Request("http://localhost:3000/api/inngest", {
          method: "PUT",
          headers: { host: "localhost:3000" },
        }),
      );

      const body = Option.getOrNull(capturedRequests[0]!.body) as {
        functions: Array<{ checkpoint?: unknown }>;
      } | null;
      expect(body).toBeTruthy();
      // Fn-level opt-out wins — no `checkpoint` block emitted.
      expect(body!.functions[0]!.checkpoint).toBeUndefined();
    } finally {
      await dispose();
    }
  });

  it("handles registration failure gracefully", async () => {
    const failingHttpClient = makeFailingHttpClient();

    const clientLayer = InngestClient.layer({
      id: "test-app",
      eventKey: "test-key",
    }).pipe(Layer.provide(failingHttpClient));

    const fullLayer = Layer.mergeAll(HandlersLive, clientLayer, failingHttpClient);

    const { handler, dispose } = InngestGroup.toWebHandler(Group, { layer: fullLayer });

    try {
      const response = await handler(
        new Request("http://localhost:3000/api/inngest", {
          method: "PUT",
          headers: { host: "localhost:3000" },
        }),
      );

      // Spec §4.3.3: registration failure SHOULD return 500 with
      // `{ message, modified: false }` body — never let the toWebHandler
      // generic 500 wrapper escape.
      expect(response.status).toBe(500);
      const body = (await response.json()) as { message?: string; modified?: boolean };
      expect(body.modified).toBe(false);
      expect(typeof body.message).toBe("string");
    } finally {
      await dispose();
    }
  });
});
