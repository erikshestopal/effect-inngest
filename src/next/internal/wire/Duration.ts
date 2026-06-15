import { Duration, Schema, SchemaGetter, SchemaTransformation } from "effect";

const EncodableDuration = Schema.Duration.pipe(
  Schema.check(
    Schema.makeFilter((duration: Duration.Duration) =>
      Duration.isFinite(duration) && !Duration.isNegative(duration) ? undefined : "a finite non-negative duration",
    ),
  ),
);

export const InngestDuration = EncodableDuration.pipe(
  Schema.encodeTo(Schema.String, {
    decode: SchemaTransformation.durationFromString.decode,
    encode: SchemaGetter.transform((duration) => {
      const parts = Duration.parts(duration);
      const weeks = Math.floor(parts.days / 7);
      const days = parts.days % 7;

      return (
        [
          weeks > 0 ? `${weeks}w` : "",
          days > 0 ? `${days}d` : "",
          parts.hours > 0 ? `${parts.hours}h` : "",
          parts.minutes > 0 ? `${parts.minutes}m` : "",
          parts.seconds > 0 ? `${parts.seconds}s` : "",
          parts.millis > 0 ? `${parts.millis}ms` : "",
        ].join("") || "0s"
      );
    }),
  }),
);
