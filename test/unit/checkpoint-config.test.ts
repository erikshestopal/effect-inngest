import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { describe, expect, it } from "@effect/vitest";
import { InngestFunction, InngestEvent } from "../../src/index.js";
import * as Checkpoint from "../../src/internal/checkpoint.js";

describe("Checkpoint config (spec §10.1)", () => {
  describe("resolveConfig precedence", () => {
    it("checkpointing true uses defaults", () => {
      const cfg = Checkpoint.resolveConfig(true, undefined);
      expect(cfg).toBeDefined();
      expect(cfg!.bufferedSteps).toBe(1);
      expect(Duration.toMillis(cfg!.maxInterval)).toBe(0);
      expect(Duration.toMillis(cfg!.maxRuntime)).toBe(10_000);
    });

    it("function-level explicit overrides defaults", () => {
      const cfg = Checkpoint.resolveConfig({ bufferedSteps: 5, maxInterval: "200 millis" }, undefined);
      expect(cfg).toBeDefined();
      expect(cfg!.bufferedSteps).toBe(5);
      expect(Duration.toMillis(cfg!.maxInterval)).toBe(200);
      expect(Duration.toMillis(cfg!.maxRuntime)).toBe(10_000);
    });

    it("checkpointing false at function level disables", () => {
      expect(Checkpoint.resolveConfig(false, true)).toBeUndefined();
      expect(Checkpoint.resolveConfig(false, { bufferedSteps: 10 })).toBeUndefined();
    });

    it("client-level checkpointing applies when function-level absent", () => {
      const cfg = Checkpoint.resolveConfig(undefined, { bufferedSteps: 3, maxInterval: "1 second" });
      expect(cfg).toBeDefined();
      expect(cfg!.bufferedSteps).toBe(3);
      expect(Duration.toMillis(cfg!.maxInterval)).toBe(1000);
    });

    it("function-level checkpointing overrides client", () => {
      const cfg = Checkpoint.resolveConfig({ bufferedSteps: 7 }, { bufferedSteps: 99 });
      expect(cfg).toBeDefined();
      expect(cfg!.bufferedSteps).toBe(7);
    });

    it("client-level false disables when function-level absent", () => {
      expect(Checkpoint.resolveConfig(undefined, false)).toBeUndefined();
    });

    it("both undefined yields defaults (default-on)", () => {
      const cfg = Checkpoint.resolveConfig(undefined, undefined);
      expect(cfg).toBeDefined();
      expect(cfg!.bufferedSteps).toBe(1);
    });

    it("function-level true always uses defaults, ignoring client object config", () => {
      // `true` at fn level = "enable with safe defaults" per the
      // CheckpointingOption docstring. Client tuning does NOT leak through.
      const cfg = Checkpoint.resolveConfig(true, { bufferedSteps: 12, maxInterval: "5 seconds" });
      expect(cfg).toBeDefined();
      expect(cfg!.bufferedSteps).toBe(1);
      expect(Duration.toMillis(cfg!.maxInterval)).toBe(0);
      expect(Duration.toMillis(cfg!.maxRuntime)).toBe(10_000);
    });
  });

  describe("toRegistration shape", () => {
    it("emits batch_steps, batch_interval, max_runtime", () => {
      const reg = Checkpoint.toRegistration({
        bufferedSteps: 3,
        maxInterval: Duration.seconds(3),
        maxRuntime: Duration.seconds(10),
      });
      expect(reg).toEqual({
        batch_steps: 3,
        batch_interval: "3s",
        max_runtime: "10s",
      });
    });

    it("formats zero durations", () => {
      const reg = Checkpoint.toRegistration({
        bufferedSteps: 1,
        maxInterval: Duration.millis(0),
        maxRuntime: Duration.seconds(10),
      });
      expect(reg.batch_interval).toBe("0s");
      expect(reg.batch_steps).toBe(1);
    });
  });

  describe("Function registration payload", () => {
    const Trigger = InngestEvent.make("ckpt/test", Schema.Struct({ v: Schema.String }));

    it("serializes checkpoint config into registration payload", () => {
      const Fn = InngestFunction.make("ckpt-fn", {
        trigger: { event: Trigger },
        checkpointing: { bufferedSteps: 2, maxInterval: "500 millis", maxRuntime: "8 seconds" },
      });
      const reg = Fn.toRegistration({ appId: "app", url: "http://x/api/inngest" });
      expect(reg.checkpoint).toEqual({
        batch_steps: 2,
        batch_interval: "500ms",
        max_runtime: "8s",
      });
    });

    it("checkpointing true uses defaults", () => {
      const Fn = InngestFunction.make("ckpt-fn", {
        trigger: { event: Trigger },
        checkpointing: true,
      });
      const reg = Fn.toRegistration({ appId: "app", url: "http://x/api/inngest" });
      expect(reg.checkpoint).toEqual({
        batch_steps: 1,
        batch_interval: "0s",
        max_runtime: "10s",
      });
    });

    it("checkpointing false omits registration block", () => {
      const Fn = InngestFunction.make("ckpt-fn", {
        trigger: { event: Trigger },
        checkpointing: false,
      });
      const reg = Fn.toRegistration({ appId: "app", url: "http://x/api/inngest" });
      expect(reg.checkpoint).toBeUndefined();
    });

    it("absent checkpointing leaves block undefined (client-level decides at runtime)", () => {
      const Fn = InngestFunction.make("ckpt-fn", {
        trigger: { event: Trigger },
      });
      const reg = Fn.toRegistration({ appId: "app", url: "http://x/api/inngest" });
      expect(reg.checkpoint).toBeUndefined();
    });
  });

  describe("CheckpointState.record + flush + completed", () => {
    it.effect("flushes when buffer reaches bufferedSteps", () =>
      Effect.gen(function* () {
        const flushed: Array<ReadonlyArray<unknown>> = [];
        const state = yield* Checkpoint.make({
          config: { bufferedSteps: 2, maxInterval: Duration.zero, maxRuntime: Duration.seconds(10) },
          runId: "r1",
          fnId: "f1",
          qiId: "q1",
          checkpointAsync: (steps) =>
            Effect.sync(() => {
              flushed.push(steps);
            }),
        });

        const op = (id: string) => ({ op: "StepRun" as const, id, name: id });

        yield* state.record(op("a") as never);
        expect(flushed.length).toBe(0);
        yield* state.record(op("b") as never);
        // bufferedSteps reached → flush
        expect(flushed.length).toBe(1);
        expect(flushed[0]).toHaveLength(2);

        const remaining = yield* state.takeCompleted();
        expect(remaining).toHaveLength(0);
      }),
    );

    it.effect("graceful fallback: API failure restores buffer for drain", () =>
      Effect.gen(function* () {
        const state = yield* Checkpoint.make({
          config: { bufferedSteps: 1, maxInterval: Duration.zero, maxRuntime: Duration.seconds(10) },
          runId: "r1",
          fnId: "f1",
          qiId: "q1",
          checkpointAsync: (_steps) => Effect.fail(new Checkpoint.CheckpointApiError({ message: "boom", status: 500 })),
        });

        const op = (id: string) => ({ op: "StepRun" as const, id, name: id });

        yield* state.record(op("a") as never);
        // Flush failed → buffer restored
        const drained = yield* state.takeCompleted();
        expect(drained).toHaveLength(1);
      }),
    );
  });
});
