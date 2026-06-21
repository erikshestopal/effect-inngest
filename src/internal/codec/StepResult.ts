import { Effect, Predicate, Schema } from "effect";
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

export const encodeUnknownJson = (args: {
  readonly value: unknown;
  readonly stepId: string;
}): Effect.Effect<Schema.Json, StepError> =>
  Predicate.isUndefined(args.value)
    ? Effect.succeed(null)
    : Schema.decodeUnknownEffect(Schema.Json)(args.value).pipe(
        Effect.mapError((cause) => stepDecodeError({ stepId: args.stepId, cause })),
      );
