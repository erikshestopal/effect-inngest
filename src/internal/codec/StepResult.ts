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

export const stepDecodeError = (args: { readonly stepId: string; readonly cause: unknown }): StepError =>
  StepError.make({
    stepId: args.stepId,
    message: messageFromCause(args.cause),
    noRetry: true,
    cause: args.cause,
  });

export const failDecode = (stepId: string, cause: unknown): Effect.Effect<never, StepError> =>
  Effect.fail(stepDecodeError({ stepId, cause }));

export const orStepDecodeError: {
  (stepId: string): <A, E, R>(effect: Effect.Effect<A, E, R>) => Effect.Effect<A, StepError, R>;
  <A, E, R>(effect: Effect.Effect<A, E, R>, stepId: string): Effect.Effect<A, StepError, R>;
} = Function.dual(2, <A, E, R>(effect: Effect.Effect<A, E, R>, stepId: string) =>
  effect.pipe(Effect.mapError((cause) => stepDecodeError({ stepId, cause }))),
);

export const decodeJson: {
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
    Schema.decodeUnknownEffect(schema)(value).pipe(orStepDecodeError(stepId)),
);

export const encodeJson: {
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
    Schema.encodeUnknownEffect(Schema.toCodecJson(schema))(value).pipe(orStepDecodeError(stepId)),
);

export const encodeUnknownJson = (args: {
  readonly value: unknown;
  readonly stepId: string;
}): Effect.Effect<Schema.Json, StepError> =>
  Predicate.isUndefined(args.value)
    ? Effect.succeed(null)
    : Schema.decodeUnknownEffect(Schema.Json)(args.value).pipe(orStepDecodeError(args.stepId));
