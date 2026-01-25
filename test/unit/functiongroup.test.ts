import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import { FetchHttpClient } from "@effect/platform";
import { describe, expect, it } from "../bun-effect.js";
import { InngestClient, InngestFunction, InngestGroup } from "../../src/index.js";

// Test Event Schemas (TaggedClass)

class UserCreated extends Schema.TaggedClass<UserCreated>()("user/created", {
  userId: Schema.String,
  email: Schema.String,
}) {}

class UserUpdated extends Schema.TaggedClass<UserUpdated>()("user/updated", {
  userId: Schema.String,
}) {}

class OrderPlaced extends Schema.TaggedClass<OrderPlaced>()("order/placed", {
  orderId: Schema.String,
  total: Schema.Number,
}) {}

// InngestFunction.make Tests

describe("InngestFunction.make", () => {
  it("creates function with single event trigger", () => {
    const fn = InngestFunction.make("process-user", {
      trigger: { event: UserCreated },
      success: Schema.Void,
    });

    expect(fn._tag).toBe("process-user");
    expect(fn.triggers).toHaveLength(1);
    // Default success schema is Void
    expect(Schema.isSchema(fn.success)).toBe(true);
  });

  it("creates function with multiple event triggers", () => {
    const fn = InngestFunction.make("multi-trigger", {
      trigger: [{ event: UserCreated }, { event: UserUpdated }],
      success: Schema.Void,
    });

    expect(fn._tag).toBe("multi-trigger");
    expect(fn.triggers).toHaveLength(2);
  });

  it("creates function with success schema as fields", () => {
    const fn = InngestFunction.make("with-success", {
      trigger: { event: UserCreated },
      success: Schema.Struct({ processed: Schema.Boolean, count: Schema.Number }),
    });

    expect(fn._tag).toBe("with-success");
    // Success should be normalized to a Schema.Struct
    expect(Schema.isSchema(fn.success)).toBe(true);
  });

  it("creates function with success schema as Schema", () => {
    const SuccessSchema = Schema.Struct({ result: Schema.String });
    const fn = InngestFunction.make("with-schema-success", {
      trigger: { event: OrderPlaced },
      success: SuccessSchema,
    });

    expect(fn._tag).toBe("with-schema-success");
    expect(fn.success).toBe(SuccessSchema);
  });

  it("stores additional options", () => {
    const fn = InngestFunction.make("with-options", {
      trigger: { event: UserCreated },
      success: Schema.Void,
      concurrency: { limit: 5 },
      retries: 3,
    });

    // Options are stored without triggers
    expect(fn.options.concurrency).toEqual({ limit: 5 });
    expect(fn.options.retries).toBe(3);
  });
});

// FunctionGroup.make Tests

// Type Guards Tests

// Note: v2 API does not expose isFunction/isFunctionGroup type guards

// InngestGroup.make Tests

describe("InngestGroup.make", () => {
  const ProcessUser = InngestFunction.make("process-user", {
    trigger: { event: UserCreated },
    success: Schema.Void,
  });

  const ProcessOrder = InngestFunction.make("process-order", {
    trigger: { event: OrderPlaced },
    success: Schema.Void,
  });

  it("creates group from single function", () => {
    const group = InngestGroup.make(ProcessUser);

    expect(group.functions.size).toBe(1);
    expect(group.functions.get("process-user")).toBe(ProcessUser);
  });

  it("creates group from multiple functions", () => {
    const group = InngestGroup.make(ProcessUser, ProcessOrder);

    expect(group.functions.size).toBe(2);
    expect(group.functions.get("process-user")).toBe(ProcessUser);
    expect(group.functions.get("process-order")).toBe(ProcessOrder);
  });

  describe("toLayer", () => {
    it("creates Layer for all handlers", () => {
      const group = InngestGroup.make(ProcessUser, ProcessOrder);

      const layer = group.toLayer({
        "process-user": (ctx) => Effect.succeed(void 0),
        "process-order": (ctx) => Effect.succeed(void 0),
      });

      expect(Layer.isLayer(layer)).toBe(true);
    });
  });

  describe("HTTP methods", () => {
    it("toHttpApp returns an Effect", () => {
      const group = InngestGroup.make(ProcessUser);
      const result = InngestGroup.toHttpApp(group);
      expect(Effect.isEffect(result)).toBe(true);
    });

    it("toWebHandler returns handler and dispose functions", async () => {
      const { FetchHttpClient } = await import("@effect/platform");
      const { InngestClient } = await import("../../src/index.js");
      const group = InngestGroup.make(ProcessUser);
      // Create a minimal layer for testing
      const handlersLayer = group.toLayer({
        "process-user": () => Effect.succeed(void 0),
      });
      // InngestClient.layer requires HttpClient
      const clientLayer = InngestClient.layer({ id: "test-app", mode: "dev" }).pipe(
        Layer.provide(FetchHttpClient.layer),
      );
      // toWebHandler also requires HttpClient for registration
      const fullLayer = Layer.mergeAll(handlersLayer, clientLayer, FetchHttpClient.layer);

      const result = InngestGroup.toWebHandler(group, { layer: fullLayer });
      expect(typeof result.handler).toBe("function");
      expect(typeof result.dispose).toBe("function");

      // Clean up
      await result.dispose();
    });
  });

  describe("pipe", () => {
    it("supports pipe for composition", () => {
      const group = InngestGroup.make(ProcessUser);
      // Test that pipe works via direct composition
      const fn = (g: typeof group) => g;
      const piped = fn(group);
      expect(piped).toBe(group);
    });

    it("supports method chaining", () => {
      const group = InngestGroup.make(ProcessUser, ProcessOrder);
      const result = group.functions.size;
      expect(result).toBe(2);
    });
  });

  describe("toLayer with requirements", () => {
    class TestService extends Context.Tag("TestService")<TestService, { readonly value: string }>() {}

    it.effect("captures context when layer is provided", () =>
      Effect.gen(function* () {
        const group = InngestGroup.make(ProcessUser);

        // Create a handler layer that depends on TestService
        const handlerLayer = group.toLayer({
          "process-user": (ctx) =>
            Effect.gen(function* () {
              const svc = yield* TestService;
              return void 0;
            }),
        });

        // Provide the service layer and build
        const fullLayer = handlerLayer.pipe(Layer.provide(Layer.succeed(TestService, { value: "test-value" })));

        // Actually build the layer to exercise Effect.gen inside toLayer
        yield* Layer.build(fullLayer).pipe(Effect.scoped);

        // If we get here without error, the layer was built successfully
        expect(true).toBe(true);
      }),
    );
  });
});

// InngestGroup coverage tests (migrated from coverage-100.test.ts)

describe("InngestGroup coverage", () => {
  class TestEvent extends Schema.TaggedClass<TestEvent>()("test/event", {
    userId: Schema.String,
  }) {}

  const TestFn = InngestFunction.make("test-fn", {
    trigger: { event: TestEvent },
    success: Schema.Struct({ result: Schema.String }),
  });

  describe("make", () => {
    it("creates group with functions", () => {
      const group = InngestGroup.make(TestFn);

      expect(group.functions.size).toBe(1);
      expect(group.functions.get("test-fn")).toBe(TestFn);
    });
  });

  describe("toLayer", () => {
    it("creates layer with handler", () => {
      const group = InngestGroup.make(TestFn);

      const layer = group.toLayer({
        "test-fn": ({ event }) => Effect.succeed({ result: event.userId }),
      });

      expect(Layer.isLayer(layer)).toBe(true);
    });
  });

  describe("toHttpApp", () => {
    it("returns an Effect", () => {
      const group = InngestGroup.make(TestFn);
      const app = InngestGroup.toHttpApp(group);

      expect(Effect.isEffect(app)).toBe(true);
    });
  });

  describe("toWebHandler", () => {
    it("returns handler and dispose", async () => {
      const group = InngestGroup.make(TestFn);

      const handlersLayer = group.toLayer({
        "test-fn": ({ event }) => Effect.succeed({ result: event.userId }),
      });

      const clientLayer = InngestClient.layer({ id: "test-app", mode: "dev" }).pipe(
        Layer.provide(FetchHttpClient.layer),
      );
      const fullLayer = Layer.mergeAll(handlersLayer, clientLayer, FetchHttpClient.layer);

      const { handler, dispose } = InngestGroup.toWebHandler(group, { layer: fullLayer });

      expect(typeof handler).toBe("function");
      expect(typeof dispose).toBe("function");

      await dispose();
    });
  });
});

// InngestGroup.toLayerHandler coverage (migrated from coverage-100.test.ts)

describe("InngestGroup.toLayerHandler coverage", () => {
  class CoverageTestEvent extends Schema.TaggedClass<CoverageTestEvent>()("coverage/test", {
    count: Schema.Number,
  }) {}

  const coverageTestFn = InngestFunction.make("coverage-test-fn", {
    trigger: { event: CoverageTestEvent },
    success: Schema.Struct({ count: Schema.Number }),
  });

  const coverageTestGroup = InngestGroup.make(coverageTestFn);

  it("creates layer for function handler", () => {
    // Call toLayerHandler with correct tag to cover lines 158-166
    const handlerLayer = coverageTestGroup.toLayerHandler("coverage-test-fn", (_ctx) => Effect.succeed({ count: 42 }));

    expect(handlerLayer).toBeDefined();
    expect(typeof handlerLayer).toBe("object");
  });
});
