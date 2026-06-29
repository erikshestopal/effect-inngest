import { describe, expect, it } from "@effect/vitest";
import { Option, Schema } from "effect";
import { pipe } from "effect/Function";
import { normalize, stringify } from "../../src/internal/utils/safe-stringify.js";

const parseStringified = (...args: Parameters<typeof stringify>): unknown =>
  pipe(
    stringify(...args),
    Option.fromUndefinedOr,
    Option.map(Schema.decodeUnknownSync(Schema.UnknownFromJsonString)),
    Option.getOrNull,
  );

const withSelfReference = (value: Record<string, unknown>): Record<string, unknown> => {
  value.self = value;
  return value;
};

describe("safe-stringify", () => {
  it("replaces circular references with json-stringify-safe compatible paths", () => {
    const value = withSelfReference({ name: "root", list: [] as Array<unknown> });
    value.list = [value];

    expect(parseStringified(value)).toEqual({
      name: "root",
      self: "[Circular ~]",
      list: ["[Circular ~]"],
    });
  });

  it("delegates to a caller replacer after decycling", () => {
    const value = withSelfReference({ keep: true, remove: true });

    expect(
      parseStringified(value, (key, child) => {
        if (key === "remove") {
          return undefined;
        }
        return child;
      }),
    ).toEqual({ keep: true, self: "[Circular ~]" });
  });

  it("supports custom cycle replacers", () => {
    const value = withSelfReference({});

    expect(parseStringified(value, undefined, undefined, () => "cycle")).toEqual({ self: "cycle" });
  });

  it("normalizes values with Inngest-compatible JSON semantics", () => {
    const value = withSelfReference({
      date: new Date("2026-02-03T00:00:00.000Z"),
      nested: { big: 1n },
      list: [1n, undefined, () => "ignored"],
    });

    expect(normalize(value)).toEqual({
      date: "2026-02-03T00:00:00.000Z",
      nested: {},
      list: [null, null, null],
      self: "[Circular ~]",
    });
    expect(normalize(undefined)).toBeNull();
  });
});
