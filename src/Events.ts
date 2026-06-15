/**
 * Internal Inngest events that the platform sends automatically.
 * Use these as triggers to react to function lifecycle events.
 * @since 0.1.0
 */
import { Schema } from "effect";

/**
 * Error structure used in internal Inngest events.
 * @since 0.1.0
 */
export class JsonError extends Schema.Class<JsonError>("JsonError")({
  name: Schema.String,
  message: Schema.String,
  stack: Schema.optional(Schema.String),
  cause: Schema.optional(Schema.Unknown),
}) {}

/**
 * Sent when a function fails after exhausting all retries.
 * Trigger on this to handle failures (e.g., alerting, cleanup).
 * @since 0.1.0
 */
export class FunctionFailed extends Schema.TaggedClass<FunctionFailed>()("inngest/function.failed", {
  function_id: Schema.String,
  run_id: Schema.String,
  error: JsonError,
  event: Schema.Record(Schema.String, Schema.Unknown),
}) {}

/**
 * Sent when a function finishes with an error.
 * @since 0.1.0
 */
export class FunctionFinishedError extends Schema.TaggedClass<FunctionFinishedError>()("inngest/function.finished", {
  function_id: Schema.String,
  run_id: Schema.String,
  correlation_id: Schema.optional(Schema.String),
  error: JsonError,
}) {}

/**
 * Sent when a function finishes successfully.
 * @since 0.1.0
 */
export class FunctionFinishedSuccess extends Schema.TaggedClass<FunctionFinishedSuccess>()(
  "inngest/function.finished",
  {
    function_id: Schema.String,
    run_id: Schema.String,
    correlation_id: Schema.optional(Schema.String),
    result: Schema.Unknown,
  },
) {}

/**
 * Union of both FunctionFinished variants.
 * @since 0.1.0
 */
export const FunctionFinished = Schema.Union([FunctionFinishedError, FunctionFinishedSuccess]);
export type FunctionFinished = typeof FunctionFinished.Type;

/**
 * Sent when a function is cancelled.
 * @since 0.1.0
 */
export class FunctionCancelled extends Schema.TaggedClass<FunctionCancelled>()("inngest/function.cancelled", {
  function_id: Schema.String,
  run_id: Schema.String,
  correlation_id: Schema.optional(Schema.String),
}) {}

/**
 * Sent when a function is invoked via step.invoke().
 * @since 0.1.0
 */
export class FunctionInvoked extends Schema.TaggedClass<FunctionInvoked>()("inngest/function.invoked", {
  data: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
}) {}

/**
 * Sent when a cron trigger fires.
 * @since 0.1.0
 */
export class ScheduledTimer extends Schema.TaggedClass<ScheduledTimer>()("inngest/scheduled.timer", {
  cron: Schema.String,
}) {}
