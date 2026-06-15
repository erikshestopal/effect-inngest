import { describe, expect, it } from "@effect/vitest";
import * as DateTime from "effect/DateTime";
import * as Schema from "effect/Schema";
import * as WireTimestamp from "../../../src/next/internal/wire/Timestamp.js";

const decodeTimestamp = Schema.decodeUnknownSync(WireTimestamp.InngestTimestamp);

describe("next wire InngestTimestamp", () => {
  it("passes timestamp strings through unchanged", () => {
    expect(decodeTimestamp("2026-06-15T12:00:00.000Z")).toBe("2026-06-15T12:00:00.000Z");
  });

  it("encodes Date and epoch millisecond inputs as ISO strings", () => {
    expect(decodeTimestamp(DateTime.toDateUtc(DateTime.makeUnsafe("2026-06-15T12:00:00.000Z")))).toBe(
      "2026-06-15T12:00:00.000Z",
    );
    expect(decodeTimestamp(Date.UTC(2026, 5, 15, 12, 0, 0, 0))).toBe("2026-06-15T12:00:00.000Z");
  });
});
