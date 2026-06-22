import { Effect, Function, Predicate, Schema } from "effect";
import { StepError } from "../errors.js";

const messageFromCause = (cause: unknown): string => {
  if (Predicate.hasProperty(cause, "cause")) {
    const nested = messageFromCause(cause.cause);
    if (nested.length > 0) {
      return nested;
    }
  }

  const message = Predicate.hasProperty(cause, "message") ? String(cause.message) : "";
  if (message.length > 0) {
    return message;
  }

  const rendered = String(cause);
  return rendered.length > 0 ? rendered : "Step result schema decode failed";
};

export const memoDecodeError = (args: { readonly stepId: string; readonly cause: unknown }): StepError =>
  StepError.make({
    stepId: args.stepId,
    message: messageFromCause(args.cause),
    noRetry: true,
    cause: args.cause,
  });

export const failMemoDecode = (stepId: string, cause: unknown): Effect.Effect<never, StepError> =>
  Effect.fail(memoDecodeError({ stepId, cause }));

export const mapMemoDecodeError: {
  (stepId: string): <A, E, R>(effect: Effect.Effect<A, E, R>) => Effect.Effect<A, StepError, R>;
  <A, E, R>(effect: Effect.Effect<A, E, R>, stepId: string): Effect.Effect<A, StepError, R>;
} = Function.dual(2, <A, E, R>(effect: Effect.Effect<A, E, R>, stepId: string) =>
  effect.pipe(Effect.mapError((cause) => memoDecodeError({ stepId, cause }))),
);

export const decodeMemo: {
  <S extends Schema.Codec<unknown, Schema.Json, never, never>>(
    schema: S,
    stepId: string,
  ): (value: unknown) => Effect.Effect<S["Type"], StepError>;
  <S extends Schema.Codec<unknown, Schema.Json, never, never>>(
    value: unknown,
    schema: S,
    stepId: string,
  ): Effect.Effect<S["Type"], StepError>;
} = Function.dual(
  3,
  <S extends Schema.Codec<unknown, Schema.Json, never, never>>(value: unknown, schema: S, stepId: string) =>
    Schema.decodeUnknownEffect(schema)(value).pipe(mapMemoDecodeError(stepId)),
);

export const encodeMemo: {
  <S extends Schema.Codec<unknown, unknown, never, never>>(
    schema: S,
    stepId: string,
  ): (value: unknown) => Effect.Effect<Schema.Json, StepError>;
  <S extends Schema.Codec<unknown, unknown, never, never>>(
    value: unknown,
    schema: S,
    stepId: string,
  ): Effect.Effect<Schema.Json, StepError>;
} = Function.dual(
  3,
  <S extends Schema.Codec<unknown, unknown, never, never>>(value: unknown, schema: S, stepId: string) =>
    Schema.encodeUnknownEffect(Schema.toCodecJson(schema))(value).pipe(mapMemoDecodeError(stepId)),
);
