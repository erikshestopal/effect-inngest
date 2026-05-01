/**
 * Protocol module unit tests
 */
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { describe, expect, it } from "@effect/vitest";
import * as Protocol from "../../src/internal/protocol.js";

describe("Protocol coverage", () => {
  describe("Opcode constants", () => {
    it("has all expected opcodes", () => {
      expect(Protocol.Opcode.None).toBe("None");
      expect(Protocol.Opcode.Step).toBe("Step");
      expect(Protocol.Opcode.StepRun).toBe("StepRun");
      expect(Protocol.Opcode.StepError).toBe("StepError");
      expect(Protocol.Opcode.StepPlanned).toBe("StepPlanned");
      expect(Protocol.Opcode.Sleep).toBe("Sleep");
      expect(Protocol.Opcode.WaitForEvent).toBe("WaitForEvent");
      expect(Protocol.Opcode.InvokeFunction).toBe("InvokeFunction");
      expect(Protocol.Opcode.AIGateway).toBe("AIGateway");
      expect(Protocol.Opcode.Gateway).toBe("Gateway");
      expect(Protocol.Opcode.WaitForSignal).toBe("WaitForSignal");
      expect(Protocol.Opcode.RunComplete).toBe("RunComplete");
      expect(Protocol.Opcode.StepFailed).toBe("StepFailed");
      expect(Protocol.Opcode.SyncRunComplete).toBe("SyncRunComplete");
      expect(Protocol.Opcode.DiscoveryRequest).toBe("DiscoveryRequest");
    });
  });

  describe("Headers constants", () => {
    it("has all expected headers", () => {
      expect(Protocol.Headers.SDK).toBe("X-Inngest-SDK");
      expect(Protocol.Headers.Signature).toBe("X-Inngest-Signature");
      expect(Protocol.Headers.RequestVersion).toBe("x-inngest-req-version");
      expect(Protocol.Headers.NoRetry).toBe("X-Inngest-No-Retry");
      expect(Protocol.Headers.RetryAfter).toBe("Retry-After");
      expect(Protocol.Headers.ServerKind).toBe("X-Inngest-Server-Kind");
      expect(Protocol.Headers.ExpectedServerKind).toBe("X-Inngest-Expected-Server-Kind");
      expect(Protocol.Headers.RunID).toBe("X-Run-ID");
      expect(Protocol.Headers.Framework).toBe("X-Inngest-Framework");
      expect(Protocol.Headers.Platform).toBe("X-Inngest-Platform");
      expect(Protocol.Headers.Env).toBe("X-Inngest-Env");
    });
  });

  describe("UserError schema", () => {
    it("decodes valid user error", () => {
      const input = { name: "TestError", message: "Test message" };
      const result = Schema.decodeUnknownSync(Protocol.UserError)(input);
      expect(result.name).toBe("TestError");
      expect(result.message).toBe("Test message");
    });

    it("decodes user error with stack", () => {
      const input = { name: "TestError", message: "Test message", stack: "at test.ts:1" };
      const result = Schema.decodeUnknownSync(Protocol.UserError)(input);
      expect(result.stack).toBe("at test.ts:1");
    });

    it("creates UserError with .make()", () => {
      const err = Protocol.UserError.make({
        name: "ValidationError",
        message: "Invalid input",
        stack: "Error: ...\n  at ...",
        data: { field: "email" },
        noRetry: true,
        cause: { code: "E001" },
      });
      expect(err.name).toBe("ValidationError");
      expect(err.message).toBe("Invalid input");
      expect(err.noRetry).toBe(true);
    });

    it("creates UserError with minimal fields", () => {
      const err = Protocol.UserError.make({ name: "Error", message: "fail" });
      expect(err.name).toBe("Error");
      expect(err.stack).toBeUndefined();
    });
  });

  describe("GeneratorOpcode schema", () => {
    it("decodes StepRun opcode", () => {
      const input = {
        op: "StepRun",
        id: "step-123",
        name: "my-step",
        displayName: "My Step",
        data: { key: "value" },
      };
      const result = Schema.decodeUnknownSync(Protocol.GeneratorOpcode)(input);
      expect(result.op).toBe("StepRun");
      expect(result.id).toBe("step-123");
    });

    it("decodes Sleep opcode", () => {
      const input = {
        op: "Sleep",
        id: "sleep-123",
        name: "5s",
        displayName: "sleep-step",
        mode: "async",
      };
      const result = Schema.decodeUnknownSync(Protocol.GeneratorOpcode)(input);
      expect(result.op).toBe("Sleep");
    });

    it("decodes WaitForEvent opcode", () => {
      const input = {
        op: "WaitForEvent",
        id: "wait-123",
        name: "wait-step",
        displayName: "Wait Step",
        opts: { event: "test/event", timeout: "1h" },
      };
      const result = Schema.decodeUnknownSync(Protocol.GeneratorOpcode)(input);
      expect(result.op).toBe("WaitForEvent");
    });

    it("decodes InvokeFunction opcode", () => {
      const input = {
        op: "InvokeFunction",
        id: "invoke-123",
        name: "invoke-step",
        displayName: "Invoke Step",
        mode: "async",
        opts: {
          function_id: "app-fn",
          payload: { data: {} },
          timeout: "1h",
        },
      };
      const result = Schema.decodeUnknownSync(Protocol.GeneratorOpcode)(input);
      expect(result.op).toBe("InvokeFunction");
    });

    it("creates GeneratorOpcode with .make()", () => {
      const op = Protocol.GeneratorOpcode.make({
        op: Protocol.Opcode.StepRun,
        id: "step-hash-123",
        name: "my-step",
        mode: "sync",
        opts: { type: "step.run" },
        data: { result: "value" },
        displayName: "My Step",
        userland: { id: "user-step-id" },
      });
      expect(op.op).toBe("StepRun");
      expect(op.id).toBe("step-hash-123");
      expect(op.mode).toBe("sync");
    });

    it("creates GeneratorOpcode for Sleep", () => {
      const op = Protocol.GeneratorOpcode.make({
        op: Protocol.Opcode.Sleep,
        id: "sleep-hash",
        name: "sleep-step",
        opts: { duration: "1h" },
      });
      expect(op.op).toBe("Sleep");
    });

    it("creates GeneratorOpcode for WaitForEvent", () => {
      const op = Protocol.GeneratorOpcode.make({
        op: Protocol.Opcode.WaitForEvent,
        id: "wait-hash",
        name: "wait-step",
        opts: { event: "user/verified", timeout: "24h" },
      });
      expect(op.op).toBe("WaitForEvent");
    });

    it("creates GeneratorOpcode with error", () => {
      const op = Protocol.GeneratorOpcode.make({
        op: Protocol.Opcode.StepError,
        id: "err-hash",
        name: "failed-step",
        error: Protocol.UserError.make({ name: "Error", message: "oops" }),
      });
      expect(op.op).toBe("StepError");
      expect(op.error?.message).toBe("oops");
    });
  });

  describe("FunctionStack schema", () => {
    it("decodes function stack", () => {
      const input = {
        stack: ["fn-1", "fn-2"],
        current: 1,
      };
      const result = Schema.decodeUnknownSync(Protocol.FunctionStack)(input);
      expect(result.stack).toEqual(["fn-1", "fn-2"]);
      expect(result.current).toBe(1);
    });

    it("creates FunctionStack with .make()", () => {
      const stack = Protocol.FunctionStack.make({
        stack: ["hash1", "hash2", "hash3"],
        current: 2,
      });
      expect(stack.stack).toEqual(["hash1", "hash2", "hash3"]);
      expect(stack.current).toBe(2);
    });
  });

  describe("InngestEvent schema", () => {
    it("decodes event with minimal fields", () => {
      const input = { name: "test/event", data: {} };
      const result = Schema.decodeUnknownSync(Protocol.InngestEvent)(input);
      expect(result.name).toBe("test/event");
    });

    it("decodes event with all fields", () => {
      const input = {
        name: "test/event",
        data: { userId: "u1" },
        id: "evt-123",
        ts: 1234567890,
        v: "1.0",
      };
      const result = Schema.decodeUnknownSync(Protocol.InngestEvent)(input);
      expect(result.id).toBe("evt-123");
      expect(result.ts).toBe(1234567890);
    });

    it("creates InngestEvent with all fields", () => {
      const evt = Protocol.InngestEvent.make({
        id: "evt_123",
        name: "user/created",
        data: { userId: "u1", email: "test@example.com" },
        ts: 1700000000000,
        user: { id: "u1" },
        v: "2024-01-01",
      });
      expect(evt.name).toBe("user/created");
      expect(evt.id).toBe("evt_123");
      expect(evt.v).toBe("2024-01-01");
    });

    it("creates InngestEvent with minimal fields", () => {
      const evt = Protocol.InngestEvent.make({ name: "test/event", data: {} });
      expect(evt.name).toBe("test/event");
      expect(evt.data).toEqual({});
    });
  });

  describe("SDKRequestContext schema", () => {
    it("decodes request context", () => {
      const input = {
        fn_id: "my-fn",
        run_id: "run-123",
        attempt: 1,
        step_id: "step",
        disable_immediate_execution: false,
      };
      const result = Schema.decodeUnknownSync(Protocol.SDKRequestContext)(input);
      expect(result.fn_id).toBe("my-fn");
      expect(result.run_id).toBe("run-123");
      expect(result.attempt).toBe(1);
    });

    it("creates SDKRequestContext with all fields", () => {
      const ctx = Protocol.SDKRequestContext.make({
        fn_id: "app-fn-id",
        run_id: "run_abc123",
        env: "production",
        step_id: "current-step",
        attempt: 2,
        max_attempts: 5,
        stack: Protocol.FunctionStack.make({ stack: ["h1"], current: 1 }),
        qi_id: "qi_xyz",
        disable_immediate_execution: true,
        use_api: true,
      });
      expect(ctx.fn_id).toBe("app-fn-id");
      expect(ctx.attempt).toBe(2);
      expect(ctx.disable_immediate_execution).toBe(true);
    });

    it("creates SDKRequestContext with all required fields", () => {
      const ctx = Protocol.SDKRequestContext.make({
        fn_id: "fn",
        run_id: "run",
        env: "dev",
        step_id: "step",
        attempt: 0,
        max_attempts: 4,
        stack: Protocol.FunctionStack.make({ stack: [], current: 0 }),
        qi_id: "",
        disable_immediate_execution: false,
        use_api: false,
      });
      expect(ctx.env).toBe("dev");
      expect(ctx.attempt).toBe(0);
      expect(ctx.max_attempts).toBe(4);
    });
  });

  describe("SDKRequestBody schema", () => {
    it("decodes full request body", () => {
      const input = {
        event: { name: "test/event", data: {} },
        events: [{ name: "test/event", data: {} }],
        steps: {},
        ctx: {
          fn_id: "my-fn",
          run_id: "run-123",
          attempt: 1,
          step_id: "step",
          disable_immediate_execution: false,
        },
        use_api: false,
      };
      const result = Schema.decodeUnknownSync(Protocol.SDKRequestBody)(input);
      expect(result.ctx.fn_id).toBe("my-fn");
      expect(result.ctx.run_id).toBe("run-123");
    });

    it("creates SDKRequestBody with .make()", () => {
      const makeCtx = () =>
        Protocol.SDKRequestContext.make({
          fn_id: "fn",
          run_id: "run",
          env: "dev",
          step_id: "step",
          attempt: 0,
          max_attempts: 4,
          stack: Protocol.FunctionStack.make({ stack: [], current: 0 }),
          qi_id: "",
          disable_immediate_execution: false,
          use_api: false,
        });
      const body = Protocol.SDKRequestBody.make({
        event: Protocol.InngestEvent.make({ name: "test/event", data: {}, id: "e1", ts: 1234 }),
        events: [Protocol.InngestEvent.make({ name: "test/event", data: {}, id: "e1", ts: 1234 })],
        steps: { hash1: { data: "memoized" } },
        ctx: makeCtx(),
        version: 1,
        use_api: false,
      });
      expect(body.event.name).toBe("test/event");
      expect(body.steps).toEqual({ hash1: { data: "memoized" } });
    });
  });

  describe("StepResult schema", () => {
    it("decodes data result", () => {
      const input = { data: { value: 42 } };
      const result = Schema.decodeUnknownSync(Protocol.StepResult)(input);
      expect((result as { data: unknown }).data).toEqual({ value: 42 });
    });

    it("decodes error result", () => {
      const input = { error: { name: "TestError", message: "Test" } };
      const result = Schema.decodeUnknownSync(Protocol.StepResult)(input);
      expect((result as { error: { name: string } }).error.name).toBe("TestError");
    });

    it("decodes null result", () => {
      const result = Schema.decodeUnknownSync(Protocol.StepResult)(null);
      expect(result).toBeNull();
    });

    it.effect("decodes null step result", () =>
      Effect.gen(function* () {
        const result = yield* Schema.decodeUnknownEffect(Protocol.StepResult)(null);
        expect(result).toBe(null);
      }),
    );

    it.effect("decodes step result with data", () =>
      Effect.gen(function* () {
        const result = yield* Schema.decodeUnknownEffect(Protocol.StepResult)({ data: "value" });
        expect(result).toEqual({ data: "value" });
      }),
    );

    it.effect("decodes step result with error", () =>
      Effect.gen(function* () {
        const result = yield* Schema.decodeUnknownEffect(Protocol.StepResult)({
          error: { name: "Error", message: "fail" },
        });
        expect(result).toEqual({ error: { name: "Error", message: "fail" } });
      }),
    );

    it.effect("decodes StepResult with input field", () =>
      Effect.gen(function* () {
        const result = yield* Schema.decodeUnknownEffect(Protocol.StepResult)({ input: { arg: "value" } });
        expect(result).toEqual({ input: { arg: "value" } });
      }),
    );
  });

  describe("IntrospectionUnauthenticated schema", () => {
    it.effect("decodes unauthenticated introspection response", () =>
      Effect.gen(function* () {
        const result = yield* Schema.decodeUnknownEffect(Protocol.IntrospectionUnauthenticated)({
          function_count: 3,
          has_event_key: true,
          has_signing_key: true,
          has_signing_key_fallback: false,
          mode: "dev",
          schema_version: "2024-05-24",
          authentication_succeeded: false,
        });
        expect(result.function_count).toBe(3);
        expect(result.authentication_succeeded).toBe(false);
      }),
    );

    it.effect("decodes unauthenticated with null auth and functions array", () =>
      Effect.gen(function* () {
        const result = yield* Schema.decodeUnknownEffect(Protocol.IntrospectionUnauthenticated)({
          function_count: 2,
          has_event_key: false,
          has_signing_key: false,
          has_signing_key_fallback: false,
          mode: "cloud",
          schema_version: "2024-05-24",
          authentication_succeeded: null,
          functions: [{ id: "fn1" }, { id: "fn2" }],
        });
        expect(result.authentication_succeeded).toBe(null);
        expect(result.functions).toHaveLength(2);
      }),
    );
  });

  describe("IntrospectionAuthenticated schema", () => {
    it.effect("decodes authenticated introspection response", () =>
      Effect.gen(function* () {
        const result = yield* Schema.decodeUnknownEffect(Protocol.IntrospectionAuthenticated)({
          function_count: 5,
          has_event_key: true,
          has_signing_key: true,
          has_signing_key_fallback: true,
          mode: "cloud",
          schema_version: "2024-05-24",
          authentication_succeeded: true,
          api_origin: "https://api.inngest.com",
          app_id: "my-app",
          env: "production",
          event_api_origin: "https://inn.gs",
          event_key_hash: "abc123",
          framework: "effect",
          sdk_language: "js",
          sdk_version: "1.0.0",
          serve_origin: "https://myapp.com",
          serve_path: "/api/inngest",
          signing_key_fallback_hash: "xyz789",
          signing_key_hash: "def456",
        });
        expect(result.authentication_succeeded).toBe(true);
        expect(result.app_id).toBe("my-app");
        expect(result.sdk_language).toBe("js");
      }),
    );

    it.effect("decodes authenticated with null optional fields", () =>
      Effect.gen(function* () {
        const result = yield* Schema.decodeUnknownEffect(Protocol.IntrospectionAuthenticated)({
          function_count: 1,
          has_event_key: true,
          has_signing_key: true,
          has_signing_key_fallback: false,
          mode: "dev",
          schema_version: "2024-05-24",
          authentication_succeeded: true,
          api_origin: "http://localhost:8288",
          app_id: "test-app",
          env: null,
          event_api_origin: "http://localhost:8288",
          event_key_hash: null,
          framework: "effect",
          sdk_language: "js",
          sdk_version: "0.1.0",
          serve_origin: null,
          serve_path: null,
          signing_key_fallback_hash: null,
          signing_key_hash: null,
        });
        expect(result.env).toBe(null);
        expect(result.serve_origin).toBe(null);
      }),
    );
  });

  describe("IntrospectionResponse schema", () => {
    it.effect("decodes authenticated response via union", () =>
      Effect.gen(function* () {
        const result = yield* Schema.decodeUnknownEffect(Protocol.IntrospectionResponse)({
          function_count: 1,
          has_event_key: true,
          has_signing_key: true,
          has_signing_key_fallback: false,
          mode: "cloud",
          schema_version: "2024-05-24",
          authentication_succeeded: true,
          api_origin: "https://api.inngest.com",
          app_id: "my-app",
          env: "prod",
          event_api_origin: "https://inn.gs",
          event_key_hash: "hash",
          framework: "effect",
          sdk_language: "js",
          sdk_version: "1.0.0",
          serve_origin: "https://myapp.com",
          serve_path: "/api/inngest",
          signing_key_fallback_hash: null,
          signing_key_hash: "keyhash",
        });
        expect(result.authentication_succeeded).toBe(true);
      }),
    );

    it.effect("decodes unauthenticated response via union", () =>
      Effect.gen(function* () {
        const result = yield* Schema.decodeUnknownEffect(Protocol.IntrospectionResponse)({
          function_count: 0,
          has_event_key: false,
          has_signing_key: false,
          has_signing_key_fallback: false,
          mode: "dev",
          schema_version: "2024-05-24",
          authentication_succeeded: false,
        });
        expect(result.authentication_succeeded).toBe(false);
      }),
    );
  });

  describe("RegisterResponse schema (spec §4.3.1)", () => {
    it.effect("decodes { message, modified } shape", () =>
      Effect.gen(function* () {
        const result = yield* Schema.decodeUnknownEffect(Protocol.RegisterResponse)({
          message: "Successfully synced 3 functions",
          modified: true,
        });
        expect(result.message).toBe("Successfully synced 3 functions");
        expect(result.modified).toBe(true);
      }),
    );

    it.effect("rejects missing modified field", () =>
      Effect.gen(function* () {
        const result = yield* Effect.exit(Schema.decodeUnknownEffect(Protocol.RegisterResponse)({ message: "ok" }));
        expect(result._tag).toBe("Failure");
      }),
    );
  });

  describe("Schema encode functions", () => {
    it.effect("encodes UserError", () =>
      Effect.gen(function* () {
        const err = Protocol.UserError.make({ name: "Error", message: "test" });
        const encoded = yield* Schema.encodeEffect(Protocol.UserError)(err);
        expect(encoded.name).toBe("Error");
      }),
    );

    it.effect("encodes GeneratorOpcode", () =>
      Effect.gen(function* () {
        const op = Protocol.GeneratorOpcode.make({
          op: Protocol.Opcode.Step,
          id: "h1",
          name: "s1",
        });
        const encoded = yield* Schema.encodeEffect(Protocol.GeneratorOpcode)(op);
        expect(encoded.op).toBe("Step");
      }),
    );

    it.effect("encodes FunctionStack", () =>
      Effect.gen(function* () {
        const stack = Protocol.FunctionStack.make({ stack: ["a", "b"], current: 1 });
        const encoded = yield* Schema.encodeEffect(Protocol.FunctionStack)(stack);
        expect(encoded.stack).toEqual(["a", "b"]);
      }),
    );

    it.effect("encodes InngestEvent", () =>
      Effect.gen(function* () {
        const event = Protocol.InngestEvent.make({ name: "test/event", data: {}, id: "e1", ts: 1000 });
        const encoded = yield* Schema.encodeEffect(Protocol.InngestEvent)(event);
        expect(encoded.name).toBe("test/event");
      }),
    );

    it.effect("encodes SDKRequestContext", () =>
      Effect.gen(function* () {
        const ctx = Protocol.SDKRequestContext.make({
          fn_id: "fn",
          run_id: "run",
          env: "dev",
          step_id: "step",
          attempt: 0,
          max_attempts: 4,
          stack: Protocol.FunctionStack.make({ stack: [], current: 0 }),
          qi_id: "",
          disable_immediate_execution: false,
          use_api: false,
        });
        const encoded = yield* Schema.encodeEffect(Protocol.SDKRequestContext)(ctx);
        expect(encoded.fn_id).toBe("fn");
      }),
    );

    it.effect("encodes SDKRequestBody", () =>
      Effect.gen(function* () {
        const ctx = Protocol.SDKRequestContext.make({
          fn_id: "fn",
          run_id: "run",
          env: "dev",
          step_id: "step",
          attempt: 0,
          max_attempts: 4,
          stack: Protocol.FunctionStack.make({ stack: [], current: 0 }),
          qi_id: "",
          disable_immediate_execution: false,
          use_api: false,
        });
        const body = Protocol.SDKRequestBody.make({
          event: Protocol.InngestEvent.make({ name: "test/event", data: {} }),
          events: [],
          ctx,
          steps: {},
          version: 1,
          use_api: false,
        });
        const encoded = yield* Schema.encodeEffect(Protocol.SDKRequestBody)(body);
        expect(encoded.event.name).toBe("test/event");
      }),
    );
  });

  describe("Schema is type guards", () => {
    it("UserError.is returns true for valid instance", () => {
      const err = Protocol.UserError.make({ name: "Error", message: "test" });
      expect(Schema.is(Protocol.UserError)(err)).toBe(true);
    });

    it("UserError.is returns false for invalid value", () => {
      expect(Schema.is(Protocol.UserError)({ foo: "bar" })).toBe(false);
    });

    it("GeneratorOpcode.is returns true for valid instance", () => {
      const op = Protocol.GeneratorOpcode.make({
        op: Protocol.Opcode.Step,
        id: "h1",
        name: "s1",
      });
      expect(Schema.is(Protocol.GeneratorOpcode)(op)).toBe(true);
    });

    it("GeneratorOpcode.is returns false for invalid opcode", () => {
      expect(Schema.is(Protocol.GeneratorOpcode)({ op: "Invalid", id: "h1", name: "s1" })).toBe(false);
    });

    it("FunctionStack.is returns true for valid instance", () => {
      const stack = Protocol.FunctionStack.make({ stack: [], current: 0 });
      expect(Schema.is(Protocol.FunctionStack)(stack)).toBe(true);
    });

    it("InngestEvent.is returns true for valid instance", () => {
      const event = Protocol.InngestEvent.make({ name: "test/event", data: {} });
      expect(Schema.is(Protocol.InngestEvent)(event)).toBe(true);
    });

    it("SDKRequestContext.is returns true for valid instance", () => {
      const ctx = Protocol.SDKRequestContext.make({
        fn_id: "fn",
        run_id: "run",
        env: "dev",
        step_id: "step",
        attempt: 0,
        max_attempts: 4,
        stack: Protocol.FunctionStack.make({ stack: [], current: 0 }),
        qi_id: "",
        disable_immediate_execution: false,
        use_api: false,
      });
      expect(Schema.is(Protocol.SDKRequestContext)(ctx)).toBe(true);
    });

    it("SDKRequestBody.is returns true for valid instance", () => {
      const ctx = Protocol.SDKRequestContext.make({
        fn_id: "fn",
        run_id: "run",
        env: "dev",
        step_id: "step",
        attempt: 0,
        max_attempts: 4,
        stack: Protocol.FunctionStack.make({ stack: [], current: 0 }),
        qi_id: "",
        disable_immediate_execution: false,
        use_api: false,
      });
      const body = Protocol.SDKRequestBody.make({
        event: Protocol.InngestEvent.make({ name: "test/event", data: {} }),
        events: [],
        ctx,
        steps: {},
        version: 1,
        use_api: false,
      });
      expect(Schema.is(Protocol.SDKRequestBody)(body)).toBe(true);
    });

    it("StepResult.is returns true for valid step result", () => {
      expect(Schema.is(Protocol.StepResult)({ data: "test" })).toBe(true);
      expect(Schema.is(Protocol.StepResult)(null)).toBe(true);
    });

    it("IntrospectionResponse.is validates union members", () => {
      const unauthResponse = {
        function_count: 0,
        has_event_key: false,
        has_signing_key: false,
        has_signing_key_fallback: false,
        mode: "dev" as const,
        schema_version: "2024-05-24" as const,
        authentication_succeeded: false,
      };
      expect(Schema.is(Protocol.IntrospectionUnauthenticated)(unauthResponse)).toBe(true);
      expect(Schema.is(Protocol.IntrospectionResponse)(unauthResponse)).toBe(true);
    });
  });

  describe("Schema encode for introspection schemas", () => {
    it.effect("encodes IntrospectionUnauthenticated", () =>
      Effect.gen(function* () {
        const data = {
          function_count: 1,
          has_event_key: true,
          has_signing_key: true,
          has_signing_key_fallback: false,
          mode: "dev" as const,
          schema_version: "2024-05-24" as const,
          authentication_succeeded: false as const,
        };
        const decoded = yield* Schema.decodeUnknownEffect(Protocol.IntrospectionUnauthenticated)(data);
        const encoded = yield* Schema.encodeEffect(Protocol.IntrospectionUnauthenticated)(decoded);
        expect(encoded.function_count).toBe(1);
      }),
    );

    it.effect("encodes IntrospectionAuthenticated", () =>
      Effect.gen(function* () {
        const data = {
          function_count: 1,
          has_event_key: true,
          has_signing_key: true,
          has_signing_key_fallback: false,
          mode: "cloud" as const,
          schema_version: "2024-05-24" as const,
          authentication_succeeded: true as const,
          api_origin: "https://api.inngest.com",
          app_id: "app",
          env: "prod",
          event_api_origin: "https://inn.gs",
          event_key_hash: "hash",
          framework: "effect",
          sdk_language: "js",
          sdk_version: "1.0.0",
          serve_origin: null,
          serve_path: null,
          signing_key_fallback_hash: null,
          signing_key_hash: "key",
        };
        const decoded = yield* Schema.decodeUnknownEffect(Protocol.IntrospectionAuthenticated)(data);
        const encoded = yield* Schema.encodeEffect(Protocol.IntrospectionAuthenticated)(decoded);
        expect(encoded.app_id).toBe("app");
      }),
    );

    it.effect("encodes RegisterResponse", () =>
      Effect.gen(function* () {
        const data = { message: "Synced", modified: true };
        const decoded = yield* Schema.decodeUnknownEffect(Protocol.RegisterResponse)(data);
        const encoded = yield* Schema.encodeEffect(Protocol.RegisterResponse)(decoded);
        expect(encoded.message).toBe("Synced");
        expect(encoded.modified).toBe(true);
      }),
    );

    it.effect("encodes StepResult", () =>
      Effect.gen(function* () {
        const data = { data: "value" };
        const decoded = yield* Schema.decodeUnknownEffect(Protocol.StepResult)(data);
        const encoded = yield* Schema.encodeEffect(Protocol.StepResult)(decoded);
        expect(encoded).toEqual({ data: "value" });
      }),
    );

    it.effect("encodes IntrospectionResponse union", () =>
      Effect.gen(function* () {
        const unauthData = {
          function_count: 0,
          has_event_key: false,
          has_signing_key: false,
          has_signing_key_fallback: false,
          mode: "dev" as const,
          schema_version: "2024-05-24" as const,
          authentication_succeeded: false as const,
        };
        const decoded = yield* Schema.decodeUnknownEffect(Protocol.IntrospectionResponse)(unauthData);
        const encoded = yield* Schema.encodeEffect(Protocol.IntrospectionResponse)(decoded);
        expect(encoded.function_count).toBe(0);
      }),
    );
  });

  describe("stripTags regression (issue #2)", () => {
    it.effect("preserves nested _tag required for Schema.Union discrimination", () =>
      Effect.gen(function* () {
        const opcode = Protocol.GeneratorOpcode.make({
          op: Protocol.Opcode.InvokeFunction,
          id: "invoke-hash",
          name: "append-snapshot",
          mode: "async",
          opts: {
            function_id: "app-append-turn",
            payload: {
              data: {
                _tag: "cxdb/turn.append",
                contextId: "ctx-1",
                type: {
                  _tag: "VisualFeedbackSnapshotV1",
                  screenshot: "base64data",
                },
              },
              user: {},
              v: "1",
            },
            timeout: "365d",
          },
        });

        const encoded = yield* Schema.encodeEffect(Protocol.GeneratorOpcode)(opcode);
        const opts = encoded.opts as {
          function_id: string;
          payload: { data: Record<string, unknown> };
        };
        const nestedType = opts.payload.data.type as Record<string, unknown>;
        expect(nestedType._tag).toBe("VisualFeedbackSnapshotV1");
      }),
    );

    it.effect("preserves _tag inside arrays of nested objects", () =>
      Effect.gen(function* () {
        const opcode = Protocol.GeneratorOpcode.make({
          op: Protocol.Opcode.StepRun,
          id: "step-hash",
          name: "process",
          data: {
            items: [
              { _tag: "TypeA", value: 1 },
              { _tag: "TypeB", value: 2 },
            ],
          },
        });

        const encoded = yield* Schema.encodeEffect(Protocol.GeneratorOpcode)(opcode);
        const data = encoded.data as { items: Array<Record<string, unknown>> };

        expect(data.items[0]!._tag).toBe("TypeA");
        expect(data.items[1]!._tag).toBe("TypeB");
      }),
    );
  });

  describe("Schema.Class pipe and annotations", () => {
    it("UserError can be piped", () => {
      const annotated = Protocol.UserError.pipe(Schema.annotate({ title: "UserError" }));
      expect(annotated).toBeDefined();
    });

    it("GeneratorOpcode can be piped", () => {
      const annotated = Protocol.GeneratorOpcode.pipe(Schema.annotate({ title: "GeneratorOpcode" }));
      expect(annotated).toBeDefined();
    });

    it("FunctionStack can be piped", () => {
      const annotated = Protocol.FunctionStack.pipe(Schema.annotate({ title: "FunctionStack" }));
      expect(annotated).toBeDefined();
    });

    it("InngestEvent can be piped", () => {
      const annotated = Protocol.InngestEvent.pipe(Schema.annotate({ title: "InngestEvent" }));
      expect(annotated).toBeDefined();
    });

    it("SDKRequestContext can be piped", () => {
      const annotated = Protocol.SDKRequestContext.pipe(Schema.annotate({ title: "SDKRequestContext" }));
      expect(annotated).toBeDefined();
    });

    it("SDKRequestBody can be piped", () => {
      const annotated = Protocol.SDKRequestBody.pipe(Schema.annotate({ title: "SDKRequestBody" }));
      expect(annotated).toBeDefined();
    });
  });

  describe("Schema default factory functions", () => {
    it.effect("triggers SDKRequestContext defaults during decode", () =>
      Effect.gen(function* () {
        const result = yield* Schema.decodeUnknownEffect(Protocol.SDKRequestContext)({
          fn_id: "fn",
          run_id: "run",
        });
        expect(result.env).toBe("dev");
        expect(result.step_id).toBe("step");
        expect(result.attempt).toBe(0);
        expect(result.max_attempts).toBe(4);
        expect(result.qi_id).toBe("");
        expect(result.disable_immediate_execution).toBe(false);
        expect(result.use_api).toBe(false);
        expect(result.stack.stack).toEqual([]);
        expect(result.stack.current).toBe(0);
      }),
    );

    it.effect("triggers SDKRequestBody defaults during decode", () =>
      Effect.gen(function* () {
        const result = yield* Schema.decodeUnknownEffect(Protocol.SDKRequestBody)({
          event: { name: "test/event" },
          events: [],
          ctx: { fn_id: "fn", run_id: "run" },
        });
        expect(result.steps).toEqual({});
        expect(result.version).toBe(1);
        expect(result.use_api).toBe(false);
      }),
    );

    it.effect("triggers InngestEvent data default during decode", () =>
      Effect.gen(function* () {
        const result = yield* Schema.decodeUnknownEffect(Protocol.InngestEvent)({
          name: "test/event",
        });
        expect(result.data).toEqual({});
      }),
    );

    it.effect("preserves InngestEvent data null value", () =>
      Effect.gen(function* () {
        const result = yield* Schema.decodeUnknownEffect(Protocol.InngestEvent)({
          name: "test/event",
          data: null,
        });
        // v4: NullOr preserves null; withDecodingDefaultType only applies to missing/undefined
        expect(result.data).toEqual(null);
      }),
    );
  });
});
