/**
 * Internal error types for the Effect Inngest SDK.
 * @internal
 */
import * as Schema from "effect/Schema";

/**
 * @internal
 */
export class SignatureError extends Schema.TaggedError<SignatureError>()("SignatureError", {
  message: Schema.String,
}) {}

/**
 * @internal
 */
export class RegistrationError extends Schema.TaggedError<RegistrationError>()("RegistrationError", {
  message: Schema.String,
  functions: Schema.Array(Schema.String),
}) {}

/**
 * @internal
 */
export class FunctionNotFoundError extends Schema.TaggedError<FunctionNotFoundError>()("FunctionNotFoundError", {
  message: Schema.String,
  functionId: Schema.String,
}) {}

/**
 * @internal
 */
export class SendEventError extends Schema.TaggedError<SendEventError>()("SendEventError", {
  message: Schema.String,
  events: Schema.Array(Schema.String),
}) {}

/**
 * @internal
 */
export class UseApiFetchError extends Schema.TaggedError<UseApiFetchError>()("UseApiFetchError", {
  message: Schema.String,
  endpoint: Schema.Literal("batch", "actions"),
  runId: Schema.String,
  statusCode: Schema.optionalWith(Schema.Number, { as: "Option" }),
}) {}

/**
 * @internal
 */
export class StepError extends Schema.TaggedError<StepError>()("StepError", {
  message: Schema.String,
  stepId: Schema.String,
  cause: Schema.optional(Schema.Unknown),
  noRetry: Schema.optional(Schema.Boolean),
}) {}

/**
 * @internal
 */
export const isStepError = Schema.is(StepError);

/**
 * @internal
 */
export class TimeoutError extends Schema.TaggedError<TimeoutError>()("TimeoutError", {
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
export class NonRetriableError extends Schema.TaggedError<NonRetriableError>()("NonRetriableError", {
  message: Schema.String,
  cause: Schema.optional(Schema.Unknown),
}) {}

/**
 * @internal
 */
export const isNonRetriableError = Schema.is(NonRetriableError);

/**
 * Thrown to indicate that the operation should be retried after a specific delay.
 * Use this for rate limiting or when you know when a resource will become available.
 *
 * @since 0.1.0
 * @category errors
 */
export class RetryAfterError extends Schema.TaggedError<RetryAfterError>()("RetryAfterError", {
  message: Schema.String,
  retryAfter: Schema.DurationFromMillis,
  cause: Schema.optional(Schema.Unknown),
}) {}

/**
 * @internal
 */
export const isRetryAfterError = Schema.is(RetryAfterError);

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
