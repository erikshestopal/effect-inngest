import { describe, expect, it } from "@effect/vitest";
import { decodeMemo } from "../../src/internal/memo.js";

describe("decodeMemo", () => {
  it("decodes { data: x } as MemoData", () => {
    expect(decodeMemo({ data: 42 })).toEqual({ _tag: "MemoData", data: 42 });
    expect(decodeMemo({ data: "hello" })).toEqual({ _tag: "MemoData", data: "hello" });
    expect(decodeMemo({ data: null })).toEqual({ _tag: "MemoData", data: null });
    expect(decodeMemo({ data: { nested: true } })).toEqual({ _tag: "MemoData", data: { nested: true } });
  });

  it("decodes { error: x } as MemoError", () => {
    expect(decodeMemo({ error: "fail" })).toEqual({ _tag: "MemoError", error: "fail" });
    expect(decodeMemo({ error: { name: "Error", message: "boom" } })).toEqual({
      _tag: "MemoError",
      error: { name: "Error", message: "boom" },
    });
  });

  it("decodes { input: x } as MemoInput", () => {
    expect(decodeMemo({ input: { foo: "bar" } })).toEqual({ _tag: "MemoInput", input: { foo: "bar" } });
  });

  it("decodes null as MemoTimeout", () => {
    expect(decodeMemo(null)).toEqual({ _tag: "MemoTimeout" });
  });

  it("decodes undefined as MemoNone", () => {
    expect(decodeMemo(undefined)).toEqual({ _tag: "MemoNone" });
  });

  it("decodes non-object values as MemoNone", () => {
    expect(decodeMemo(42)).toEqual({ _tag: "MemoNone" });
    expect(decodeMemo("string")).toEqual({ _tag: "MemoNone" });
    expect(decodeMemo(true)).toEqual({ _tag: "MemoNone" });
    expect(decodeMemo([])).toEqual({ _tag: "MemoNone" });
  });

  it("decodes empty object as MemoNone", () => {
    expect(decodeMemo({})).toEqual({ _tag: "MemoNone" });
  });

  // CRITICAL: Ambiguous case - error takes priority over data
  it("decodes { data, error } as MemoError (error takes priority)", () => {
    expect(decodeMemo({ data: 42, error: "fail" })).toEqual({ _tag: "MemoError", error: "fail" });
  });

  // CRITICAL: Ambiguous case - error takes priority over input
  it("decodes { input, error } as MemoError (error takes priority)", () => {
    expect(decodeMemo({ input: {}, error: "fail" })).toEqual({ _tag: "MemoError", error: "fail" });
  });

  // input takes priority over data
  it("decodes { data, input } as MemoInput (input takes priority)", () => {
    expect(decodeMemo({ data: 42, input: {} })).toEqual({ _tag: "MemoInput", input: {} });
  });
});
