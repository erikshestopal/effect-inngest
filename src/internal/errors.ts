/**
 * Internal error types for the Effect Inngest SDK.
 * @internal
 */
import { Predicate, Schema } from "effect";

/**
 * @internal
 */
export class SignatureError extends Schema.TaggedErrorClass<SignatureError>()("SignatureError", {
  message: Schema.String,
}) {}

/**
 * @internal
 */
export class RegistrationError extends Schema.TaggedErrorClass<RegistrationError>()("RegistrationError", {
  message: Schema.String,
  functions: Schema.Array(Schema.String),
}) {}

/**
 * @internal
 */
export class FunctionNotFoundError extends Schema.TaggedErrorClass<FunctionNotFoundError>()("FunctionNotFoundError", {
  message: Schema.String,
  functionId: Schema.String,
}) {}

/**
 * @internal
 */
export class SendEventError extends Schema.TaggedErrorClass<SendEventError>()("SendEventError", {
  message: Schema.String,
  events: Schema.Array(Schema.String),
}) {}

/**
 * @internal
 */
export class UseApiFetchError extends Schema.TaggedErrorClass<UseApiFetchError>()("UseApiFetchError", {
  message: Schema.String,
  endpoint: Schema.Literals(["batch", "actions"]),
  runId: Schema.String,
  statusCode: Schema.optional(Schema.Number),
}) {}

/**
 * @internal
 */
export class StepError extends Schema.TaggedErrorClass<StepError>()("StepError", {
  message: Schema.String,
  stepId: Schema.String,
  cause: Schema.optional(Schema.Unknown),
  noRetry: Schema.optional(Schema.Boolean),
}) {}

/**
 * @internal
 */
export const isStepError: (u: unknown) => u is StepError = Predicate.isTagged("StepError") as (
  u: unknown,
) => u is StepError;

/**
 * @internal
 */
export class TimeoutError extends Schema.TaggedErrorClass<TimeoutError>()("TimeoutError", {
  message: Schema.String,
  stepId: Schema.optional(Schema.String),
  timeout: Schema.DurationFromMillis,
}) {}

/**
 * Thrown to indicate that the error should not be retried.
 * Use this when you know retrying won't help (e.g., validation errors, auth failures).
 *
 * @since 0.1.0
 * @category errors
 */
export class NonRetriableError extends Schema.TaggedErrorClass<NonRetriableError>()("NonRetriableError", {
  message: Schema.String,
  cause: Schema.optional(Schema.Unknown),
}) {}

/**
 * @internal
 */
export const isNonRetriableError: (u: unknown) => u is NonRetriableError = Predicate.isTagged("NonRetriableError") as (
  u: unknown,
) => u is NonRetriableError;

/**
 * Thrown to indicate that the operation should be retried after a specific delay.
 * Use this for rate limiting or when you know when a resource will become available.
 *
 * @since 0.1.0
 * @category errors
 */
export class RetryAfterError extends Schema.TaggedErrorClass<RetryAfterError>()("RetryAfterError", {
  message: Schema.String,
  retryAfter: Schema.DurationFromMillis,
  cause: Schema.optional(Schema.Unknown),
}) {}

/**
 * @internal
 */
export const isRetryAfterError: (u: unknown) => u is RetryAfterError = Predicate.isTagged("RetryAfterError") as (
  u: unknown,
) => u is RetryAfterError;

/**
 * @internal
 */
export type ServerError = SignatureError | RegistrationError | FunctionNotFoundError;

/**
 * @internal
 */
export type ClientError = SendEventError | UseApiFetchError;

/**
 * @internal
 */
export type ExecutionError = StepError | TimeoutError;

/**
 * @internal
 */
export type RetryControlError = NonRetriableError | RetryAfterError;

/**
 * @internal
 */
export type InngestError = ServerError | ClientError | ExecutionError | RetryControlError;
