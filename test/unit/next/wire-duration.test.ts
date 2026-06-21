import { describe, expect, it } from "@effect/vitest";
import * as Duration from "effect/Duration";
import * as Schema from "effect/Schema";
import * as WireDuration from "../../../src/internal/wire/Duration.js";

const encodeDuration = Schema.encodeSync(WireDuration.InngestDuration);

describe("next wire InngestDuration", () => {
  it("encodes Effect durations as compact Inngest duration strings", () => {
    expect(encodeDuration(Duration.hours(1))).toBe("1h");
    expect(encodeDuration(Duration.sum(Duration.hours(2), Duration.minutes(30)))).toBe("2h30m");
    expect(encodeDuration(Duration.millis(1_500))).toBe("1s500ms");
    expect(encodeDuration(Duration.millis(500))).toBe("500ms");
    expect(encodeDuration(Duration.days(365 * 2))).toBe("104w2d");
    expect(encodeDuration(Duration.zero)).toBe("0s");
  });

  it("rejects encoded durations that cannot be represented as Inngest time strings", () => {
    expect(() => encodeDuration(Duration.infinity)).toThrow();
    expect(() => encodeDuration(Duration.negativeInfinity)).toThrow();
    expect(() => encodeDuration(Duration.millis(-1))).toThrow();
  });

  it("encodes normalized Duration.Input values through the wire scalar", () => {
    expect(encodeDuration(Duration.fromInputUnsafe({ seconds: 10 }))).toBe("10s");
  });
});
