/**
 * Step memoization schemas for decoding cached step results.
 * @internal
 */
import * as Predicate from "effect/Predicate";
import * as Schema from "effect/Schema";

// Wire format: require property KEY to exist (not just value to be defined)
const hasKey =
  (key: string) =>
  (u: unknown): u is Record<string, unknown> =>
    Predicate.isRecord(u) && Predicate.hasProperty(u, key);

// Output schemas (tagged structs)
const MemoDataSchema = Schema.TaggedStruct("MemoData", { data: Schema.Unknown });
const MemoErrorSchema = Schema.TaggedStruct("MemoError", { error: Schema.Unknown });
const MemoInputSchema = Schema.TaggedStruct("MemoInput", { input: Schema.Unknown });
const MemoTimeoutSchema = Schema.TaggedStruct("MemoTimeout", {});
const MemoNoneSchema = Schema.TaggedStruct("MemoNone", {});

// Wire schemas with property existence filters + tag attachment
const DataWire = Schema.Unknown.pipe(
  Schema.filter(hasKey("data")),
  Schema.transform(MemoDataSchema, {
    decode: (v) => ({ _tag: "MemoData" as const, data: (v as Record<string, unknown>).data }),
    encode: ({ data }) => ({ data }),
  }),
);

const ErrorWire = Schema.Unknown.pipe(
  Schema.filter(hasKey("error")),
  Schema.transform(MemoErrorSchema, {
    decode: (v) => ({ _tag: "MemoError" as const, error: (v as Record<string, unknown>).error }),
    encode: ({ error }) => ({ error }),
  }),
);

const InputWire = Schema.Unknown.pipe(
  Schema.filter(hasKey("input")),
  Schema.transform(MemoInputSchema, {
    decode: (v) => ({ _tag: "MemoInput" as const, input: (v as Record<string, unknown>).input }),
    encode: ({ input }) => ({ input }),
  }),
);

const TimeoutWire = Schema.transform(Schema.Null, MemoTimeoutSchema, {
  decode: () => ({ _tag: "MemoTimeout" as const }),
  encode: () => null,
});

const NoneWire = Schema.transform(Schema.Undefined, MemoNoneSchema, {
  decode: () => ({ _tag: "MemoNone" as const }),
  encode: () => undefined,
});

// Union order matters: error > input > data (more specific first)
const MemoSchema = Schema.Union(ErrorWire, InputWire, DataWire, TimeoutWire, NoneWire);

// Derived type (only union is needed externally - Match.tag uses string literals)
export type Memo = Schema.Schema.Type<typeof MemoSchema>;

/**
 * Decode a step result into a Memo type.
 * Order matters: error > input > data (more specific properties first).
 */
export const decodeMemo = (value: unknown): Memo => {
  const result = Schema.decodeUnknownOption(MemoSchema)(value);
  if (result._tag === "Some") {
    return result.value;
  }

  return MemoNoneSchema.make();
};
