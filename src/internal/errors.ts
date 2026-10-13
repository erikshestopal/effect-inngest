import { Predicate, Schema } from "effect";

export class SendEventError extends Schema.TaggedError<SendEventError>()("SendEventError", {
  message: Schema.String,
  events: Schema.Array(Schema.String),
}) {}

export class StepError extends Schema.TaggedError<StepError>()("StepError", {
  message: Schema.String,
  stepId: Schema.String,
  cause: Schema.optional(Schema.Unknown),
  noRetry: Schema.optional(Schema.Boolean),
}) {}

export const isStepError: (u: unknown) => u is StepError = Predicate.isTagged("StepError") as (
  u: unknown,
) => u is StepError;

export class NonRetriableError extends Schema.TaggedError<NonRetriableError>()("NonRetriableError", {
  message: Schema.String,
  cause: Schema.optional(Schema.Unknown),
}) {}

export const isNonRetriableError: (u: unknown) => u is NonRetriableError = Predicate.isTagged("NonRetriableError") as (
  u: unknown,
) => u is NonRetriableError;

export class RetryAfterError extends Schema.TaggedError<RetryAfterError>()("RetryAfterError", {
  message: Schema.String,
  retryAfter: Schema.DurationFromMillis,
  cause: Schema.optional(Schema.Unknown),
}) {}

export const isRetryAfterError = Schema.is(RetryAfterError);
