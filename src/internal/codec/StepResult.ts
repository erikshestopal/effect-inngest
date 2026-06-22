import { Effect, Function, Option, Predicate, Schema } from "effect";
import { StepError } from "../errors.js";

export type OptionalMemoCodec<A> = Option.Option<Schema.Codec<A, Schema.Json, never, never>>;

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
  <A>(
    schema: Schema.Codec<A, Schema.Json, never, never>,
    stepId: string,
  ): (value: unknown) => Effect.Effect<A, StepError>;
  <A>(value: unknown, schema: Schema.Codec<A, Schema.Json, never, never>, stepId: string): Effect.Effect<A, StepError>;
} = Function.dual(3, <A>(value: unknown, schema: Schema.Codec<A, Schema.Json, never, never>, stepId: string) =>
  Schema.decodeUnknownEffect(schema)(value).pipe(mapMemoDecodeError(stepId)),
);

export const encodeMemo: {
  <A, I>(
    schema: Schema.Codec<A, I, never, never>,
    stepId: string,
  ): (value: unknown) => Effect.Effect<Schema.Json, StepError>;
  <A, I>(
    value: unknown,
    schema: Schema.Codec<A, I, never, never>,
    stepId: string,
  ): Effect.Effect<Schema.Json, StepError>;
} = Function.dual(3, <A, I>(value: unknown, schema: Schema.Codec<A, I, never, never>, stepId: string) =>
  Schema.encodeUnknownEffect(Schema.toCodecJson(schema))(value).pipe(mapMemoDecodeError(stepId)),
);

export const decodeStepRunMemo =
  <A>(schema: OptionalMemoCodec<A>, stepId: string) =>
  (value: unknown): Effect.Effect<A | void, StepError> =>
    Option.match(schema, {
      onNone: () => Effect.void,
      onSome: (codec) => decodeMemo(codec, stepId)(value),
    });

export const encodeStepRunMemo =
  <A>(schema: OptionalMemoCodec<A>, stepId: string) =>
  (value: unknown): Effect.Effect<Schema.Json | undefined, StepError> =>
    Option.match(schema, {
      onNone: () => (Predicate.isUndefined(value) ? Effect.succeed(undefined) : decodeMemo(Schema.Json, stepId)(value)),
      onSome: (codec) => encodeMemo(codec, stepId)(value),
    });

export const failStepRunMemoError = (stepId: string, error: unknown): Effect.Effect<never, StepError> =>
  Effect.fail(
    StepError.make({
      stepId,
      message: Predicate.hasProperty(error, "message") ? String(error.message) : "Step failed",
      noRetry: true,
      cause: error,
    }),
  );

export const failStepRunMemoTimeout = (stepId: string): Effect.Effect<never, StepError> =>
  Effect.fail(StepError.make({ stepId, message: "Step timed out", noRetry: true }));

export const failUnexpectedStepRunMemoInput = (stepId: string, input: unknown): Effect.Effect<never, StepError> =>
  Effect.fail(StepError.make({ stepId, message: "Unexpected step result type: input", cause: input }));
