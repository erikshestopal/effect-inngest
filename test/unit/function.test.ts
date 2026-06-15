/**
 * @module test/unit/function
 * @description Tests for InngestFunction module.
 */

import * as Duration from "effect/Duration";
import * as Schema from "effect/Schema";
import { describe, expect, it } from "@effect/vitest";

import { InngestFunction, InngestEvent } from "../../src/index.js";

describe("InngestFunction coverage", () => {
  const TestEvent = InngestEvent.make(
    "test/event",
    Schema.Struct({
      userId: Schema.String,
    }),
  );

  describe("make", () => {
    it("creates function with event trigger", () => {
      const fn = InngestFunction.make("test-fn", {
        trigger: { event: TestEvent },
        success: Schema.Void,
      });

      expect(fn._tag).toBe("test-fn");
      expect(fn.triggers).toHaveLength(1);
    });

    it("creates function with cron trigger", () => {
      const fn = InngestFunction.make("cron-fn", {
        trigger: { cron: "0 9 * * *" },
        success: Schema.Void,
      });

      expect(fn._tag).toBe("cron-fn");
      expect(fn.triggers).toHaveLength(1);
    });

    it("creates function with multiple triggers", () => {
      const fn = InngestFunction.make("multi-fn", {
        trigger: [{ event: TestEvent }, { cron: "0 * * * *" }],
        success: Schema.Void,
      });

      expect(fn.triggers).toHaveLength(2);
    });

    it("creates function with options", () => {
      const fn = InngestFunction.make("options-fn", {
        trigger: { event: TestEvent },
        success: Schema.Void,
        retries: 5,
        concurrency: { limit: 10 },
      });

      expect(fn.options.retries).toBe(5);
      expect(fn.options.concurrency).toEqual({ limit: 10 });
    });
  });

  describe("toRegistration", () => {
    it("generates registration for event trigger", () => {
      const fn = InngestFunction.make("test-fn", {
        trigger: { event: TestEvent },
        success: Schema.Void,
      });

      const reg = fn.toRegistration({ appId: "my-app", url: "http://localhost:3000" });

      expect(reg.id).toBe("my-app-test-fn");
      expect(reg.name).toBe("test-fn");
      expect(reg.triggers).toEqual([{ event: "test/event", expression: undefined }]);
    });

    it("generates registration for cron trigger", () => {
      const fn = InngestFunction.make("cron-fn", {
        trigger: { cron: "0 9 * * *" },
        success: Schema.Void,
      });

      const reg = fn.toRegistration({ appId: "my-app", url: "http://localhost:3000" });

      expect(reg.triggers).toEqual([{ cron: "0 9 * * *" }]);
    });

    it("generates registration with CEL expression", () => {
      const fn = InngestFunction.make("filtered-fn", {
        trigger: { event: TestEvent, if: "event.data.userId != ''" },
        success: Schema.Void,
      });

      const reg = fn.toRegistration({ appId: "my-app", url: "http://localhost:3000" });

      expect(reg.triggers).toEqual([{ event: "test/event", expression: "event.data.userId != ''" }]);
    });

    it("serializes retries only when explicitly configured", () => {
      const defaultFn = InngestFunction.make("default-retries-fn", {
        trigger: { event: TestEvent },
        success: Schema.Void,
      });
      const customFn = InngestFunction.make("custom-retries-fn", {
        trigger: { event: TestEvent },
        success: Schema.Void,
        retries: 5,
      });

      const defaultReg = defaultFn.toRegistration({ appId: "my-app", url: "http://localhost:3000" });
      const customReg = customFn.toRegistration({ appId: "my-app", url: "http://localhost:3000" });

      expect(defaultReg.steps.step.retries).toBeUndefined();
      expect(customReg.steps.step.retries).toEqual({ attempts: 5 });
    });
  });
});

describe("InngestFunction.toRegistration coverage", () => {
  const TestEvent = InngestEvent.make(
    "test/event",
    Schema.Struct({
      userId: Schema.String,
    }),
  );

  it("serializes function with cancelOn", () => {
    const fn = InngestFunction.make("cancel-fn", {
      trigger: { event: TestEvent },
      success: Schema.Void,
      cancelOn: [{ event: "cancel/event", if: "event.data.reason != ''" }],
    });

    const reg = fn.toRegistration({ appId: "my-app", url: "http://localhost:3000" });

    expect(reg.cancel).toEqual([{ event: "cancel/event", if: "event.data.reason != ''" }]);
  });

  it("serializes function with timeouts", () => {
    const fn = InngestFunction.make("timeout-fn", {
      trigger: { event: TestEvent },
      success: Schema.Void,
      timeouts: { start: Duration.minutes(5), finish: Duration.hours(1) },
    });

    const reg = fn.toRegistration({ appId: "my-app", url: "http://localhost:3000" });

    expect(reg.timeouts).toEqual({ start: "5m", finish: "1h" });
  });

  it("serializes function with both cancelOn and timeouts", () => {
    const fn = InngestFunction.make("full-fn", {
      trigger: { event: TestEvent },
      success: Schema.Void,
      cancelOn: [{ event: "cancel/event" }],
      timeouts: { finish: Duration.minutes(30) },
    });

    const reg = fn.toRegistration({ appId: "my-app", url: "http://localhost:3000" });

    expect(reg.cancel).toEqual([{ event: "cancel/event", if: undefined }]);
    expect(reg.timeouts).toEqual({ start: undefined, finish: "30m" });
  });

  it("serializes rateLimit", () => {
    const fn = InngestFunction.make("rate-fn", {
      trigger: { event: TestEvent },
      success: Schema.Void,
      rateLimit: { key: "event.data.userId", limit: 1, period: Duration.days(1) },
    });

    const reg = fn.toRegistration({ appId: "my-app", url: "http://localhost:3000" });

    expect(reg.rateLimit).toEqual({ key: "event.data.userId", limit: 1, period: "1d" });
  });

  it("serializes throttle", () => {
    const fn = InngestFunction.make("throttle-fn", {
      trigger: { event: TestEvent },
      success: Schema.Void,
      throttle: { key: "event.data.userId", limit: 5, period: Duration.hours(1), burst: 2 },
    });

    const reg = fn.toRegistration({ appId: "my-app", url: "http://localhost:3000" });

    expect(reg.throttle).toEqual({ key: "event.data.userId", limit: 5, period: "1h", burst: 2 });
  });

  it("serializes debounce", () => {
    const fn = InngestFunction.make("debounce-fn", {
      trigger: { event: TestEvent },
      success: Schema.Void,
      debounce: { key: "event.data.userId", period: Duration.seconds(30), timeout: Duration.minutes(5) },
    });

    const reg = fn.toRegistration({ appId: "my-app", url: "http://localhost:3000" });

    expect(reg.debounce).toEqual({ key: "event.data.userId", period: "30s", timeout: "5m" });
  });

  it("serializes concurrency as number", () => {
    const fn = InngestFunction.make("conc-num-fn", {
      trigger: { event: TestEvent },
      success: Schema.Void,
      concurrency: 10,
    });

    const reg = fn.toRegistration({ appId: "my-app", url: "http://localhost:3000" });

    expect(reg.concurrency).toEqual({ limit: 10 });
  });

  it("serializes concurrency as object", () => {
    const fn = InngestFunction.make("conc-obj-fn", {
      trigger: { event: TestEvent },
      success: Schema.Void,
      concurrency: { limit: 5, key: "event.data.userId", scope: "fn" },
    });

    const reg = fn.toRegistration({ appId: "my-app", url: "http://localhost:3000" });

    expect(reg.concurrency).toEqual({ limit: 5, key: "event.data.userId", scope: "fn" });
  });

  it("serializes concurrency as tuple", () => {
    const fn = InngestFunction.make("conc-tuple-fn", {
      trigger: { event: TestEvent },
      success: Schema.Void,
      concurrency: [
        { limit: 5, key: "event.data.userId" },
        { limit: 100, scope: "account" },
      ],
    });

    const reg = fn.toRegistration({ appId: "my-app", url: "http://localhost:3000" });

    expect(reg.concurrency).toEqual([
      { limit: 5, key: "event.data.userId" },
      { limit: 100, scope: "account" },
    ]);
  });

  it("serializes priority", () => {
    const fn = InngestFunction.make("priority-fn", {
      trigger: { event: TestEvent },
      success: Schema.Void,
      priority: { run: "event.data.plan == 'enterprise' ? 180 : 0" },
    });

    const reg = fn.toRegistration({ appId: "my-app", url: "http://localhost:3000" });

    expect(reg.priority).toEqual({ run: "event.data.plan == 'enterprise' ? 180 : 0" });
  });

  it("serializes singleton", () => {
    const fn = InngestFunction.make("singleton-fn", {
      trigger: { event: TestEvent },
      success: Schema.Void,
      singleton: { key: "event.data.userId", mode: "cancel" },
    });

    const reg = fn.toRegistration({ appId: "my-app", url: "http://localhost:3000" });

    expect(reg.singleton).toEqual({ key: "event.data.userId", mode: "cancel" });
  });

  it("serializes batchEvents", () => {
    const fn = InngestFunction.make("batch-fn", {
      trigger: { event: TestEvent },
      success: Schema.Void,
      batchEvents: { maxSize: 100, timeout: Duration.seconds(10), key: "event.data.org" },
    });

    const reg = fn.toRegistration({ appId: "my-app", url: "http://localhost:3000" });

    expect(reg.batchEvents).toEqual({ maxSize: 100, timeout: "10s", key: "event.data.org" });
  });

  it("serializes idempotency", () => {
    const fn = InngestFunction.make("idemp-fn", {
      trigger: { event: TestEvent },
      success: Schema.Void,
      idempotency: "event.data.userId",
    });

    const reg = fn.toRegistration({ appId: "my-app", url: "http://localhost:3000" });

    expect(reg.idempotency).toBe("event.data.userId");
  });

  it("omits missing optional fields", () => {
    const fn = InngestFunction.make("minimal-fn", {
      trigger: { event: TestEvent },
      success: Schema.Void,
    });

    const reg = fn.toRegistration({ appId: "my-app", url: "http://localhost:3000" });

    expect(reg.rateLimit).toBeUndefined();
    expect(reg.throttle).toBeUndefined();
    expect(reg.debounce).toBeUndefined();
    expect(reg.concurrency).toBeUndefined();
    expect(reg.priority).toBeUndefined();
    expect(reg.singleton).toBeUndefined();
    expect(reg.batchEvents).toBeUndefined();
    expect(reg.idempotency).toBeUndefined();
  });
});
