import { Effect, Predicate, Schema } from "effect";
import { StepError } from "../../../internal/errors.js";

export const stepDecodeError = (args: { readonly stepId: string; readonly cause: unknown }): StepError =>
  StepError.make({
    stepId: args.stepId,
    message: Predicate.hasProperty(args.cause, "message") ? String(args.cause.message) : String(args.cause),
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
