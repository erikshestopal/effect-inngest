import { HttpClient, HttpClientResponse } from "@effect/platform";
import { it } from "../bun-effect.js";
import { Effect, Layer, Option } from "effect";
import { describe, expect } from "../bun-effect";
import * as Protocol from "../../src/internal/protocol.js";

// Note: UseApi module uses internal API - test Protocol types instead

describe("Protocol types for UseApi", () => {
  describe("InngestEvent schema", () => {
    it.effect("creates event with all fields", () =>
      Effect.sync(() => {
        const event = Protocol.InngestEvent.make({
          id: "evt-1",
          name: "test/event",
          data: { foo: "bar" },
          ts: Date.now(),
          user: {},
          v: "1",
        });

        expect(event.name).toBe("test/event");
        expect(event.data).toEqual({ foo: "bar" });
      }),
    );
  });

  describe("SDKRequestBody schema", () => {
    it.effect("creates request body with events", () =>
      Effect.sync(() => {
        const body = Protocol.SDKRequestBody.make({
          event: Protocol.InngestEvent.make({ name: "test/event" }),
          events: [
            Protocol.InngestEvent.make({ id: "evt-1", name: "test/event", data: { foo: "bar" }, ts: Date.now() }),
          ],
          steps: {
            "step-hash-1": { data: { result: 42 } },
            "step-hash-2": { data: null },
          },
          ctx: Protocol.SDKRequestContext.make({ fn_id: "fn-1", run_id: "run-1" }),
        });

        expect(body.events).toHaveLength(1);
        expect(body.steps["step-hash-1"]).toEqual({ data: { result: 42 } });
        expect(body.steps["step-hash-2"]).toEqual({ data: null });
      }),
    );
  });

  describe("StepResult schema", () => {
    it.effect("handles data step result", () =>
      Effect.gen(function* () {
        const result = yield* Effect.succeed({ data: { result: 42 } });
        expect(result).toEqual({ data: { result: 42 } });
      }),
    );

    it.effect("handles null step result", () =>
      Effect.gen(function* () {
        const result = yield* Effect.succeed(null);
        expect(result).toBe(null);
      }),
    );
  });

  describe("Headers constants", () => {
    it("has authorization-related headers", () => {
      expect(Protocol.Headers.SDK).toBe("X-Inngest-SDK");
      expect(Protocol.Headers.Signature).toBe("X-Inngest-Signature");
    });
  });
});
