/**
 * @module test/unit/function
 * @description Tests for InngestFunction module.
 */

import * as Duration from "effect/Duration";
import * as Schema from "effect/Schema";
import { describe, expect, it } from "@effect/vitest";

import { InngestFunction, InngestEvent, Inngest, InngestCron } from "../../src/index.js";

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
        trigger: TestEvent,
      });

      expect(fn._tag).toBe("test-fn");
      expect(fn.triggers).toHaveLength(1);
    });

    it("creates function with event object trigger", () => {
      const fn = InngestFunction.make("test-fn", {
        trigger: { event: TestEvent },
      });

      expect(fn._tag).toBe("test-fn");
      expect(fn.triggers).toHaveLength(1);
    });

    it("creates function with cron trigger", () => {
      const fn = InngestFunction.make("cron-fn", {
        trigger: InngestCron.make("0 9 * * *"),
      });

      expect(fn._tag).toBe("cron-fn");
      expect(fn.triggers).toHaveLength(1);
    });

    it("creates function with multiple triggers", () => {
      const fn = InngestFunction.make("multi-fn", {
        trigger: [TestEvent, InngestCron.make("0 * * * *")],
      });

      expect(fn.triggers).toHaveLength(2);
    });

    it("creates function with options", () => {
      const fn = InngestFunction.make("options-fn", {
        trigger: TestEvent,
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
        trigger: TestEvent,
      });

      const reg = fn.toRegistration({ appId: "my-app", url: "http://localhost:3000" });

      expect(reg.id).toBe("my-app-test-fn");
      expect(reg.name).toBe("test-fn");
      expect(reg.triggers).toEqual([{ event: "test/event", expression: undefined }]);
    });

    it("generates registration for cron trigger", () => {
      const fn = InngestFunction.make("cron-fn", {
        trigger: InngestCron.make("0 9 * * *"),
      });

      const reg = fn.toRegistration({ appId: "my-app", url: "http://localhost:3000" });

      expect(reg.triggers).toEqual([{ cron: "0 9 * * *" }]);
    });

    it("generates registration for cron trigger with jitter", () => {
      const fn = InngestFunction.make("cron-fn", {
        trigger: InngestCron.make("0 9 * * *", { jitter: "30s" }),
      });

      const reg = fn.toRegistration({ appId: "my-app", url: "http://localhost:3000" });

      expect(reg.triggers).toEqual([{ cron: "0 9 * * *", jitter: "30s" }]);
    });

    it("generates registration with CEL expression", () => {
      const fn = InngestFunction.make("filtered-fn", {
        trigger: { event: TestEvent, if: "event.data.userId != ''" },
      });

      const reg = fn.toRegistration({ appId: "my-app", url: "http://localhost:3000" });

      expect(reg.triggers).toEqual([{ event: "test/event", expression: "event.data.userId != ''" }]);
    });

    it("serializes retries only when explicitly configured", () => {
      const defaultFn = InngestFunction.make("default-retries-fn", {
        trigger: TestEvent,
      });
      const customFn = InngestFunction.make("custom-retries-fn", {
        trigger: TestEvent,
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
  const CancelEvent = InngestEvent.make("cancel/event");

  it("serializes function with cancelOn", () => {
    const fn = InngestFunction.make("cancel-fn", {
      trigger: TestEvent,
      cancelOn: [{ event: CancelEvent, if: "event.data.reason != ''" }],
    });

    const reg = fn.toRegistration({ appId: "my-app", url: "http://localhost:3000" });

    expect(reg.cancel).toEqual([{ event: "cancel/event", if: "event.data.reason != ''" }]);
  });

  it("serializes function with timeouts", () => {
    const fn = InngestFunction.make("timeout-fn", {
      trigger: TestEvent,
      timeouts: { start: Duration.minutes(5), finish: Duration.hours(1) },
    });

    const reg = fn.toRegistration({ appId: "my-app", url: "http://localhost:3000" });

    expect(reg.timeouts).toEqual({ start: "5m", finish: "1h" });
  });

  it("serializes function with both cancelOn and timeouts", () => {
    const fn = InngestFunction.make("full-fn", {
      trigger: TestEvent,
      cancelOn: [{ event: CancelEvent }],
      timeouts: { finish: Duration.minutes(30) },
    });

    const reg = fn.toRegistration({ appId: "my-app", url: "http://localhost:3000" });

    expect(reg.cancel).toEqual([{ event: "cancel/event", if: undefined }]);
    expect(reg.timeouts).toEqual({ start: undefined, finish: "30m" });
  });

  it("serializes rateLimit", () => {
    const fn = InngestFunction.make("rate-fn", {
      trigger: TestEvent,
      rateLimit: { key: "event.data.userId", limit: 1, period: Duration.days(1) },
    });

    const reg = fn.toRegistration({ appId: "my-app", url: "http://localhost:3000" });

    expect(reg.rateLimit).toEqual({ key: "event.data.userId", limit: 1, period: "1d" });
  });

  it("serializes throttle", () => {
    const fn = InngestFunction.make("throttle-fn", {
      trigger: TestEvent,
      throttle: { key: "event.data.userId", limit: 5, period: Duration.hours(1), burst: 2 },
    });

    const reg = fn.toRegistration({ appId: "my-app", url: "http://localhost:3000" });

    expect(reg.throttle).toEqual({ key: "event.data.userId", limit: 5, period: "1h", burst: 2 });
  });

  it("serializes debounce", () => {
    const fn = InngestFunction.make("debounce-fn", {
      trigger: TestEvent,
      debounce: { key: "event.data.userId", period: Duration.seconds(30), timeout: Duration.minutes(5) },
    });

    const reg = fn.toRegistration({ appId: "my-app", url: "http://localhost:3000" });

    expect(reg.debounce).toEqual({ key: "event.data.userId", period: "30s", timeout: "5m" });
  });

  it("serializes concurrency as number", () => {
    const fn = InngestFunction.make("conc-num-fn", {
      trigger: TestEvent,
      concurrency: 10,
    });

    const reg = fn.toRegistration({ appId: "my-app", url: "http://localhost:3000" });

    expect(reg.concurrency).toEqual({ limit: 10 });
  });

  it("serializes concurrency as object", () => {
    const fn = InngestFunction.make("conc-obj-fn", {
      trigger: TestEvent,
      concurrency: { limit: 5, key: "event.data.userId", scope: "fn" },
    });

    const reg = fn.toRegistration({ appId: "my-app", url: "http://localhost:3000" });

    expect(reg.concurrency).toEqual({ limit: 5, key: "event.data.userId", scope: "fn" });
  });

  it("serializes concurrency as tuple", () => {
    const fn = InngestFunction.make("conc-tuple-fn", {
      trigger: TestEvent,
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
      trigger: TestEvent,
      priority: { run: "event.data.plan == 'enterprise' ? 180 : 0" },
    });

    const reg = fn.toRegistration({ appId: "my-app", url: "http://localhost:3000" });

    expect(reg.priority).toEqual({ run: "event.data.plan == 'enterprise' ? 180 : 0" });
  });

  it("serializes singleton", () => {
    const fn = InngestFunction.make("singleton-fn", {
      trigger: TestEvent,
      singleton: { key: "event.data.userId", mode: "cancel" },
    });

    const reg = fn.toRegistration({ appId: "my-app", url: "http://localhost:3000" });

    expect(reg.singleton).toEqual({ key: "event.data.userId", mode: "cancel" });
  });

  it("serializes batchEvents", () => {
    const fn = InngestFunction.make("batch-fn", {
      trigger: TestEvent,
      batchEvents: { maxSize: 100, timeout: Duration.seconds(10), key: "event.data.org" },
    });

    const reg = fn.toRegistration({ appId: "my-app", url: "http://localhost:3000" });

    expect(reg.batchEvents).toEqual({ maxSize: 100, timeout: "10s", key: "event.data.org" });
  });

  it("serializes idempotency", () => {
    const fn = InngestFunction.make("idemp-fn", {
      trigger: TestEvent,
      idempotency: "event.data.userId",
    });

    const reg = fn.toRegistration({ appId: "my-app", url: "http://localhost:3000" });

    expect(reg.idempotency).toBe("event.data.userId");
  });

  it("omits missing optional fields", () => {
    const fn = InngestFunction.make("minimal-fn", {
      trigger: TestEvent,
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
