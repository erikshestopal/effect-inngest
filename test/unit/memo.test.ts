import { describe, expect, it } from "@effect/vitest";
import { decode } from "../../src/internal/domain/Memo.js";

describe("Memo.decode", () => {
  it("decodes { data: x } as MemoData", () => {
    expect(decode({ data: 42 })).toEqual({ _tag: "MemoData", data: 42 });
    expect(decode({ data: "hello" })).toEqual({ _tag: "MemoData", data: "hello" });
    expect(decode({ data: null })).toEqual({ _tag: "MemoData", data: null });
    expect(decode({ data: { nested: true } })).toEqual({ _tag: "MemoData", data: { nested: true } });
  });

  it("decodes { error: x } as MemoError", () => {
    expect(decode({ error: "fail" })).toEqual({ _tag: "MemoError", error: "fail" });
    expect(decode({ error: { name: "Error", message: "boom" } })).toEqual({
      _tag: "MemoError",
      error: { name: "Error", message: "boom" },
    });
  });

  it("decodes { input: x } as MemoInput", () => {
    expect(decode({ input: { foo: "bar" } })).toEqual({ _tag: "MemoInput", input: { foo: "bar" } });
  });

  it("decodes null as MemoTimeout", () => {
    expect(decode(null)).toEqual({ _tag: "MemoTimeout" });
  });

  it("decodes undefined as MemoNone", () => {
    expect(decode(undefined)).toEqual({ _tag: "MemoNone" });
  });

  it("decodes non-object values as MemoNone", () => {
    expect(decode(42)).toEqual({ _tag: "MemoNone" });
    expect(decode("string")).toEqual({ _tag: "MemoNone" });
    expect(decode(true)).toEqual({ _tag: "MemoNone" });
    expect(decode([])).toEqual({ _tag: "MemoNone" });
  });

  it("decodes empty object as MemoNone", () => {
    expect(decode({})).toEqual({ _tag: "MemoNone" });
  });

  // CRITICAL: Ambiguous case - error takes priority over data
  it("decodes { data, error } as MemoError (error takes priority)", () => {
    expect(decode({ data: 42, error: "fail" })).toEqual({ _tag: "MemoError", error: "fail" });
  });

  // CRITICAL: Ambiguous case - error takes priority over input
  it("decodes { input, error } as MemoError (error takes priority)", () => {
    expect(decode({ input: {}, error: "fail" })).toEqual({ _tag: "MemoError", error: "fail" });
  });

  // input takes priority over data
  it("decodes { data, input } as MemoInput (input takes priority)", () => {
    expect(decode({ data: 42, input: {} })).toEqual({ _tag: "MemoInput", input: {} });
  });
});
