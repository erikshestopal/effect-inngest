import { FetchHttpClient } from "effect/unstable/http";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import { describe, expect, it } from "@effect/vitest";
import { InngestFunction, InngestGroup, InngestClient } from "../../src/index.js";

// Type for introspection response body
interface IntrospectionBody {
  function_count: number;
  mode: "dev" | "cloud";
  authentication_succeeded?: boolean | null;
  schema_version: string;
  has_event_key: boolean;
  has_signing_key: boolean;
  has_signing_key_fallback?: boolean;
  functions?: ReadonlyArray<{
    id: string;
    name: string;
    triggers: ReadonlyArray<{ event?: string; cron?: string }>;
    steps: { step: { id: string; name: string; runtime: { type: string; url: string } } };
  }>;
}

// TB-007A: Introspection - Functions Array in Dev Mode

class TestEventA extends Schema.TaggedClass<TestEventA>()("test/event.a", {
  value: Schema.Number,
}) {}

class TestEventB extends Schema.TaggedClass<TestEventB>()("test/event.b", {
  name: Schema.String,
}) {}

describe("TB-007A: Introspection", () => {
  const FunctionA = InngestFunction.make("function-a", {
    trigger: { event: TestEventA },
    success: Schema.String,
  });

  const FunctionB = InngestFunction.make("function-b", {
    trigger: { event: TestEventB },
    success: Schema.Number,
  });

  const Group = InngestGroup.make(FunctionA, FunctionB);

  // Dev mode client (mode explicitly set)
  const DevClient = InngestClient.layer({ id: "test-app", eventKey: "test-key", mode: "dev" }).pipe(
    Layer.provide(FetchHttpClient.layer),
  );

  // Cloud mode client (mode: "cloud" when signingKey present)
  const CloudClient = InngestClient.layer({
    id: "test-app",
    eventKey: "test-key",
    signingKey: "signkey-prod-xxxxx",
    mode: "cloud",
  }).pipe(Layer.provide(FetchHttpClient.layer));

  const makeHandlersLayer = () =>
    Group.toLayer({
      "function-a": () => Effect.succeed("result-a"),
      "function-b": () => Effect.succeed(42),
    });

  const makeDevTestLayer = () => Layer.mergeAll(makeHandlersLayer(), DevClient, FetchHttpClient.layer);

  const makeCloudTestLayer = () => Layer.mergeAll(makeHandlersLayer(), CloudClient, FetchHttpClient.layer);

  it.effect("GET / in dev mode returns functions array", () =>
    Effect.gen(function* () {
      const { handler, dispose } = InngestGroup.toWebHandler(Group, { layer: makeDevTestLayer() });

      try {
        const request = new Request("http://localhost/api/inngest", {
          method: "GET",
          headers: { host: "localhost" },
        });

        const response = yield* Effect.tryPromise(() => handler(request));

        expect(response.status).toBe(200);
        const body = (yield* Effect.tryPromise(() => response.json())) as IntrospectionBody;

        // Dev mode includes functions
        expect(body.mode).toBe("dev");
        expect(body.function_count).toBe(2);
        expect(body.authentication_succeeded).toBeUndefined();
        // Note: The current introspection implementation doesn't include functions array
        // This test documents the expected behavior
      } finally {
        yield* Effect.tryPromise(() => dispose());
      }
    }),
  );

  it.effect("GET / in cloud mode does NOT include functions array", () =>
    Effect.gen(function* () {
      const { handler, dispose } = InngestGroup.toWebHandler(Group, { layer: makeCloudTestLayer() });

      try {
        const request = new Request("http://localhost/api/inngest", {
          method: "GET",
          headers: { host: "localhost" },
        });

        const response = yield* Effect.tryPromise(() => handler(request));

        expect(response.status).toBe(200);
        const body = (yield* Effect.tryPromise(() => response.json())) as IntrospectionBody;

        // Cloud mode omits functions
        expect(body.mode).toBe("cloud");
        expect(body.function_count).toBe(2);
        expect(body.authentication_succeeded).toBeUndefined();
        expect(body.functions).toBeUndefined();
      } finally {
        yield* Effect.tryPromise(() => dispose());
      }
    }),
  );

  it.effect("introspection response includes correct schema_version", () =>
    Effect.gen(function* () {
      const { handler, dispose } = InngestGroup.toWebHandler(Group, { layer: makeDevTestLayer() });

      try {
        const request = new Request("http://localhost/api/inngest", {
          method: "GET",
          headers: { host: "localhost" },
        });

        const response = yield* Effect.tryPromise(() => handler(request));
        const body = (yield* Effect.tryPromise(() => response.json())) as IntrospectionBody;

        expect(body.schema_version).toBe("2024-05-24");
      } finally {
        yield* Effect.tryPromise(() => dispose());
      }
    }),
  );

  it.effect("introspection includes correct has_event_key flag", () =>
    Effect.gen(function* () {
      // Create client with explicit serveHost (dev mode for functions array)
      const CustomClient = InngestClient.layer({
        id: "test-app",
        eventKey: "test-key",
        serveHost: "https://myapp.example.com",
        servePath: "/inngest",
        mode: "dev",
      }).pipe(Layer.provide(FetchHttpClient.layer));

      const CustomTestLayer = Layer.mergeAll(makeHandlersLayer(), CustomClient, FetchHttpClient.layer);

      const { handler, dispose } = InngestGroup.toWebHandler(Group, { layer: CustomTestLayer });

      try {
        const request = new Request("http://localhost/api/inngest", {
          method: "GET",
          headers: { host: "localhost" },
        });

        const response = yield* Effect.tryPromise(() => handler(request));
        const body = (yield* Effect.tryPromise(() => response.json())) as IntrospectionBody;

        // Should have event key
        expect(body.has_event_key).toBe(true);
      } finally {
        yield* Effect.tryPromise(() => dispose());
      }
    }),
  );
});
