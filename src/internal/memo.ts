/**
 * Step memoization schemas for decoding cached step results.
 * @internal
 */
import { Option, Predicate, Schema, SchemaTransformation } from "effect";

// Wire format: require property KEY to exist (not just value to be defined)
const hasKey =
  (key: string) =>
  (u: unknown): u is Record<string, unknown> =>
    Predicate.isObject(u) && Predicate.hasProperty(u, key);

// Output schemas (tagged structs)
const MemoDataSchema = Schema.TaggedStruct("MemoData", { data: Schema.Unknown });
const MemoErrorSchema = Schema.TaggedStruct("MemoError", { error: Schema.Unknown });
const MemoInputSchema = Schema.TaggedStruct("MemoInput", { input: Schema.Unknown });
const MemoTimeoutSchema = Schema.TaggedStruct("MemoTimeout", {});
const MemoNoneSchema = Schema.TaggedStruct("MemoNone", {});

// Wire schemas with property existence filters + tag attachment
const DataWire = Schema.Unknown.pipe(
  Schema.check(Schema.makeFilter(hasKey("data"))),
  Schema.decodeTo(
    MemoDataSchema,
    SchemaTransformation.transform({
      decode: (v) => ({ _tag: "MemoData" as const, data: (v as Record<string, unknown>).data }),
      encode: ({ data }) => ({ data }),
    }),
  ),
);

const ErrorWire = Schema.Unknown.pipe(
  Schema.check(Schema.makeFilter(hasKey("error"))),
  Schema.decodeTo(
    MemoErrorSchema,
    SchemaTransformation.transform({
      decode: (v) => ({ _tag: "MemoError" as const, error: (v as Record<string, unknown>).error }),
      encode: ({ error }) => ({ error }),
    }),
  ),
);

const InputWire = Schema.Unknown.pipe(
  Schema.check(Schema.makeFilter(hasKey("input"))),
  Schema.decodeTo(
    MemoInputSchema,
    SchemaTransformation.transform({
      decode: (v) => ({ _tag: "MemoInput" as const, input: (v as Record<string, unknown>).input }),
      encode: ({ input }) => ({ input }),
    }),
  ),
);

const TimeoutWire = Schema.Null.pipe(
  Schema.decodeTo(
    MemoTimeoutSchema,
    SchemaTransformation.transform({
      decode: () => ({ _tag: "MemoTimeout" as const }),
      encode: () => null,
    }),
  ),
);

const NoneWire = Schema.Undefined.pipe(
  Schema.decodeTo(
    MemoNoneSchema,
    SchemaTransformation.transform({
      decode: () => ({ _tag: "MemoNone" as const }),
      encode: () => undefined,
    }),
  ),
);

// Union order matters: error > input > data (more specific first)
const MemoSchema = Schema.Union([ErrorWire, InputWire, DataWire, TimeoutWire, NoneWire]);

// Derived type (only union is needed externally - Match.tag uses string literals)
export type Memo = Schema.Schema.Type<typeof MemoSchema>;

/**
 * Decode a step result into a Memo type.
 * Order matters: error > input > data (more specific properties first).
 */
export const decodeMemo = (value: unknown): Memo =>
  Option.getOrElse(Schema.decodeUnknownOption(MemoSchema)(value), () => MemoNoneSchema.make({}));
