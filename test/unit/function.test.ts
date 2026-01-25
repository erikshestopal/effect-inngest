/**
 * @module test/unit/function
 * @description Tests for InngestFunction module.
 */

import * as Duration from "effect/Duration";
import * as Schema from "effect/Schema";
import { describe, expect, it } from "../bun-effect.js";

import { InngestFunction } from "../../src/index.js";

describe("InngestFunction coverage", () => {
  class TestEvent extends Schema.TaggedClass<TestEvent>()("test/event", {
    userId: Schema.String,
  }) {}

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
  });
});

describe("InngestFunction.toRegistration coverage", () => {
  class TestEvent extends Schema.TaggedClass<TestEvent>()("test/event", {
    userId: Schema.String,
  }) {}

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
});
