import { DateTime, Predicate, Schema, identity, SchemaTransformation } from "effect";

const TimestampInput = Schema.Union([Schema.String, Schema.Number, Schema.DateValid]);
type TimestampInput = typeof TimestampInput.Type;

const decode = (value: TimestampInput) =>
  Predicate.isString(value) ? value : DateTime.formatIso(DateTime.makeUnsafe(value));

export const InngestTimestamp = TimestampInput.pipe(
  Schema.decodeTo(Schema.String, SchemaTransformation.transform<string, TimestampInput>({ decode, encode: identity })),
);
