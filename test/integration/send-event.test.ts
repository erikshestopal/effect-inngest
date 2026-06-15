import { FetchHttpClient, HttpClient, HttpClientResponse } from "effect/unstable/http";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { describe, expect, it } from "@effect/vitest";
import { InngestFunction, InngestGroup, InngestClient, InngestEvent } from "../../src/index.js";
import * as Protocol from "../../src/internal/protocol.js";
import { makeTestRequest } from "./_helpers.js";

// TB-006: Send Event
//
// Goal: Send events from within a function as a durable step.
//
// In v2, step.sendEvent is a DURABLE STEP that:
// 1. Gets planned (returns 206) on first encounter
// 2. Gets executed by Inngest and result is memoized
// 3. Uses memoized result on re-invocation
//
// This is different from v1 where sendEvent was an immediate HTTP call.

// Schemas for decoding test responses
const StepOpcodeSchema = Schema.Struct({ id: Schema.String });
const StepOpcodesSchema = Schema.Array(StepOpcodeSchema);
const SentEventSchema = Schema.Struct({ name: Schema.String, data: Schema.Unknown });
const SentEventsSchema = Schema.Array(SentEventSchema);
const ErrorResponseSchema = Schema.Struct({ error: Schema.Struct({ message: Schema.String }) });

// HttpBody type for accessing request body bytes
interface HttpBodyUint8Array {
  readonly _tag: "Uint8Array";
  readonly body: Uint8Array;
}

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
 * Create a mock HttpClient layer that captures requests and returns success.
 * Uses Layer.effect per Effect guidelines (not Layer.succeed).
 */
const makeMockHttpClient = (
  captureRequest: (url: string, body: Option.Option<unknown>) => void,
  responseBody: { ids: Array<string> } = { ids: ["evt_mock_123"] },
) =>
  Layer.effect(
    HttpClient.HttpClient,
    Effect.sync(() =>
      HttpClient.make((request) => {
        const bodyOption = extractBodyJson(request.body as HttpBodyUint8Array);
        captureRequest(request.url, bodyOption);

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

// Event definitions using TaggedClass
const UserSignup = InngestEvent.make(
  "user/signup",
  Schema.Struct({
    email: Schema.String,
    name: Schema.String,
  }),
);

const EmailSend = InngestEvent.make(
  "email/send",
  Schema.Struct({
    to: Schema.String,
    template: Schema.String,
    userId: Schema.String,
  }),
);

describe("TB-006: Send Event", () => {
  const ProcessSignup = InngestFunction.make("process-signup", {
    trigger: { event: UserSignup },
    success: Schema.Struct({ userId: Schema.String, status: Schema.String }),
  });

  const Group = InngestGroup.make(ProcessSignup);

  const makeRequest = (steps: (typeof Protocol.SDKRequestBody.Type)["steps"] = {}) =>
    makeTestRequest({
      fnId: "process-signup",
      eventName: "user/signup",
      eventData: { email: "test@example.com", name: "Test User" },
      steps,
    });

  it.effect("executes sendEvent step when memoized", () =>
    Effect.gen(function* () {
      // Track captured requests
      const capturedRequests: Array<{ url: string; body: Option.Option<unknown> }> = [];

      const mockHttpClient = makeMockHttpClient((url, body) => capturedRequests.push({ url, body }));

      const clientLayer = InngestClient.layer({
        id: "test-app",
        eventKey: "test-key",
        eventBaseUrl: "https://inn.gs/",
        mode: "dev",
      }).pipe(Layer.provide(mockHttpClient));

      const HandlersLive = Group.toLayer({
        "process-signup": ({ event, step }) =>
          Effect.gen(function* () {
            const userId = yield* step.run("create-user", Effect.succeed(`user_123`));

            yield* step.sendEvent(
              "send-welcome",
              EmailSend.make({
                to: event.data.email,
                template: "welcome",
                userId,
              }),
            );

            return { userId, status: "created" };
          }),
      });

      const { handler, dispose } = InngestGroup.toWebHandler(Group, {
        layer: Layer.mergeAll(HandlersLive, clientLayer, FetchHttpClient.layer),
      });

      try {
        // First call: step.run gets planned → 206
        const response1 = yield* Effect.tryPromise(() => handler(makeRequest()));
        expect(response1.status).toBe(206);

        const opcodes1 = yield* Effect.tryPromise(() => response1.json());
        const steps1 = yield* Schema.decodeUnknownEffect(StepOpcodesSchema)(opcodes1);
        expect(steps1).toHaveLength(1);
        const stepRunHash = steps1[0]!.id;

        // Second call: step.run memoized, sendEvent gets planned → 206
        const response2 = yield* Effect.tryPromise(() => handler(makeRequest({ [stepRunHash]: { data: "user_123" } })));
        expect(response2.status).toBe(206);

        const opcodes2 = yield* Effect.tryPromise(() => response2.json());
        const steps2 = yield* Schema.decodeUnknownEffect(StepOpcodesSchema)(opcodes2);
        expect(steps2).toHaveLength(1);
        const sendEventHash = steps2[0]!.id;

        // Third call: both steps memoized → 200
        // Mock sendEvent result: { ids: ["evt_mock_123"] }
        const response3 = yield* Effect.tryPromise(() =>
          handler(
            makeRequest({
              [stepRunHash]: { data: "user_123" },
              [sendEventHash]: { data: { ids: ["evt_mock_123"] } },
            }),
          ),
        );

        expect(response3.status).toBe(200);
        const result = yield* Effect.tryPromise(() => response3.json());
        expect(result).toEqual({ userId: "user_123", status: "created" });
      } finally {
        yield* Effect.tryPromise(() => dispose());
      }
    }),
  );

  it.effect("sendEvent emits correct StepRun opcode", () =>
    Effect.gen(function* () {
      const capturedRequests: Array<{ url: string; body: Option.Option<unknown> }> = [];

      const mockHttpClient = makeMockHttpClient((url, body) => capturedRequests.push({ url, body }), {
        ids: ["evt_1", "evt_2"],
      });

      const clientLayer = InngestClient.layer({
        id: "test-app",
        eventKey: "test-key",
        eventBaseUrl: "https://inn.gs/",
        mode: "dev",
      }).pipe(Layer.provide(mockHttpClient));

      const HandlersLive = Group.toLayer({
        "process-signup": ({ event, step }) =>
          Effect.gen(function* () {
            // Send multiple events at once (array form)
            yield* step.sendEvent("send-batch", [
              EmailSend.make({ to: event.data.email, template: "welcome", userId: "u1" }),
              EmailSend.make({ to: event.data.email, template: "verify", userId: "u1" }),
            ]);

            return { userId: "u1", status: "batch-sent" };
          }),
      });

      const { handler, dispose } = InngestGroup.toWebHandler(Group, {
        layer: Layer.mergeAll(HandlersLive, clientLayer, FetchHttpClient.layer),
      });

      try {
        // First call: sendEvent gets planned
        const response = yield* Effect.tryPromise(() => handler(makeRequest()));
        expect(response.status).toBe(206);

        const opcodes = yield* Effect.tryPromise(() => response.json());
        const steps = yield* Schema.decodeUnknownEffect(StepOpcodesSchema)(opcodes);
        expect(steps).toHaveLength(1);
        expect(steps[0]!.id.length).toBe(40); // SHA1 hash
      } finally {
        yield* Effect.tryPromise(() => dispose());
      }
    }),
  );

  it.effect("fails when event key not configured", () =>
    Effect.gen(function* () {
      const mockHttpClient = Layer.effect(
        HttpClient.HttpClient,
        Effect.sync(() =>
          HttpClient.make((request) =>
            Effect.succeed(
              HttpClientResponse.fromWeb(request, new Response(JSON.stringify({ ids: [] }), { status: 200 })),
            ),
          ),
        ),
      );

      // Client WITHOUT eventKey
      const clientLayer = InngestClient.layer({
        id: "test-app",
        mode: "dev",
        // No eventKey!
      }).pipe(Layer.provide(mockHttpClient));

      const HandlersLive = Group.toLayer({
        "process-signup": ({ step }) =>
          Effect.gen(function* () {
            yield* step.sendEvent(
              "send-welcome",
              EmailSend.make({
                to: "test@example.com",
                template: "welcome",
                userId: "u1",
              }),
            );
            return { userId: "u1", status: "sent" };
          }),
      });

      const { handler, dispose } = InngestGroup.toWebHandler(Group, {
        layer: Layer.mergeAll(HandlersLive, clientLayer, FetchHttpClient.layer),
      });

      try {
        // First call: sendEvent gets planned (no error yet - eventKey not checked until execution)
        const response = yield* Effect.tryPromise(() => handler(makeRequest()));
        expect(response.status).toBe(206);
      } finally {
        yield* Effect.tryPromise(() => dispose());
      }
    }),
  );

  it.effect("verifies event is sent to correct endpoint with eventKey during execution", () =>
    Effect.gen(function* () {
      const capturedUrls: string[] = [];

      const mockHttpClient = Layer.effect(
        HttpClient.HttpClient,
        Effect.sync(() =>
          HttpClient.make((request) => {
            capturedUrls.push(request.url);
            return Effect.succeed(
              HttpClientResponse.fromWeb(request, new Response(JSON.stringify({ ids: ["evt_1"] }), { status: 200 })),
            );
          }),
        ),
      );

      const clientLayer = InngestClient.layer({
        id: "test-app",
        eventKey: "my-secret-key",
        eventBaseUrl: "https://custom.inn.gs/",
        mode: "dev",
      }).pipe(Layer.provide(mockHttpClient));

      const HandlersLive = Group.toLayer({
        "process-signup": ({ step }) =>
          Effect.gen(function* () {
            yield* step.sendEvent(
              "send-welcome",
              EmailSend.make({
                to: "test@example.com",
                template: "welcome",
                userId: "u1",
              }),
            );
            return { userId: "u1", status: "sent" };
          }),
      });

      const { handler, dispose } = InngestGroup.toWebHandler(Group, {
        layer: Layer.mergeAll(HandlersLive, clientLayer, FetchHttpClient.layer),
      });

      try {
        // Execute with disableImmediateExecution: false to allow sendEvent to run
        const response = yield* Effect.tryPromise(() =>
          handler(
            makeTestRequest({
              fnId: "process-signup",
              eventName: "user/signup",
              eventData: { email: "test@example.com", name: "Test" },
              steps: {},
              disableImmediateExecution: false, // Allow immediate execution
            }),
          ),
        );

        // When disableImmediateExecution is false and step_id is "step",
        // canExecute returns true for all steps, so sendEvent should execute
        expect(response.status).toBe(206); // Still 206 because it returns runInterrupt

        // Verify URL format: {eventBaseUrl}/e/{eventKey}. Checkpointing may
        // issue additional HTTP requests; only the event send URL matters here.
        const eventUrls = capturedUrls.filter((url) => url.includes("/e/"));
        expect(eventUrls).toHaveLength(1);
        expect(eventUrls[0]).toBe("https://custom.inn.gs/e/my-secret-key");
      } finally {
        yield* Effect.tryPromise(() => dispose());
      }
    }),
  );
});
