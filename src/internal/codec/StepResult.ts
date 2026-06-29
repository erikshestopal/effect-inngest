import { Effect, Function, Predicate } from "effect";
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
