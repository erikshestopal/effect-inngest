import { Predicate, Schema } from "effect";

export class SignatureError extends Schema.TaggedErrorClass<SignatureError>()("SignatureError", {
  message: Schema.String,
}) {}

export class RegistrationError extends Schema.TaggedErrorClass<RegistrationError>()("RegistrationError", {
  message: Schema.String,
  functions: Schema.Array(Schema.String),
}) {}

export class FunctionNotFoundError extends Schema.TaggedErrorClass<FunctionNotFoundError>()("FunctionNotFoundError", {
  message: Schema.String,
  functionId: Schema.String,
}) {}

export class SendEventError extends Schema.TaggedErrorClass<SendEventError>()("SendEventError", {
  message: Schema.String,
  events: Schema.Array(Schema.String),
}) {}

export class UseApiFetchError extends Schema.TaggedErrorClass<UseApiFetchError>()("UseApiFetchError", {
  message: Schema.String,
  endpoint: Schema.Literals(["batch", "actions"]),
  runId: Schema.String,
  statusCode: Schema.optional(Schema.Number),
}) {}

export class StepError extends Schema.TaggedErrorClass<StepError>()("StepError", {
  message: Schema.String,
  stepId: Schema.String,
  cause: Schema.optional(Schema.Unknown),
  noRetry: Schema.optional(Schema.Boolean),
}) {}

export const isStepError: (u: unknown) => u is StepError = Predicate.isTagged("StepError") as (
  u: unknown,
) => u is StepError;

export class TimeoutError extends Schema.TaggedErrorClass<TimeoutError>()("TimeoutError", {
  message: Schema.String,
  stepId: Schema.optional(Schema.String),
  timeout: Schema.DurationFromMillis,
}) {}

export class NonRetriableError extends Schema.TaggedErrorClass<NonRetriableError>()("NonRetriableError", {
  message: Schema.String,
  cause: Schema.optional(Schema.Unknown),
}) {}

export const isNonRetriableError: (u: unknown) => u is NonRetriableError = Predicate.isTagged("NonRetriableError") as (
  u: unknown,
) => u is NonRetriableError;

export class RetryAfterError extends Schema.TaggedErrorClass<RetryAfterError>()("RetryAfterError", {
  message: Schema.String,
  retryAfter: Schema.DurationFromMillis,
  cause: Schema.optional(Schema.Unknown),
}) {}

export const isRetryAfterError: (u: unknown) => u is RetryAfterError = Predicate.isTagged("RetryAfterError") as (
  u: unknown,
) => u is RetryAfterError;

export type ServerError = SignatureError | RegistrationError | FunctionNotFoundError;

export type ClientError = SendEventError | UseApiFetchError;

export type ExecutionError = StepError | TimeoutError;

export type RetryControlError = NonRetriableError | RetryAfterError;

export type InngestError = ServerError | ClientError | ExecutionError | RetryControlError;
