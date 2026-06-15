/**
 * Internal Inngest events that the platform sends automatically.
 * Use these as triggers to react to function lifecycle events.
 * @since 0.1.0
 */
import { Schema } from "effect";
import * as InngestEvent from "./Event.js";

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
export const FunctionFailed = InngestEvent.make(
  "inngest/function.failed",
  Schema.Struct({
    function_id: Schema.String,
    run_id: Schema.String,
    error: JsonError,
    event: Schema.Record(Schema.String, Schema.Unknown),
  }),
);

/**
 * Sent when a function finishes with an error.
 * @since 0.1.0
 */
const FunctionFinishedErrorData = Schema.Struct({
  function_id: Schema.String,
  run_id: Schema.String,
  correlation_id: Schema.optional(Schema.String),
  error: JsonError,
});

export const FunctionFinishedError = InngestEvent.make("inngest/function.finished", FunctionFinishedErrorData);

/**
 * Sent when a function finishes successfully.
 * @since 0.1.0
 */
const FunctionFinishedSuccessData = Schema.Struct({
  function_id: Schema.String,
  run_id: Schema.String,
  correlation_id: Schema.optional(Schema.String),
  result: Schema.Unknown,
});

export const FunctionFinishedSuccess = InngestEvent.make("inngest/function.finished", FunctionFinishedSuccessData);

/**
 * Union of both FunctionFinished variants.
 * @since 0.1.0
 */
export const FunctionFinished = InngestEvent.make(
  "inngest/function.finished",
  Schema.Union([FunctionFinishedErrorData, FunctionFinishedSuccessData]),
);
export type FunctionFinished = typeof FunctionFinished.Type;

/**
 * Sent when a function is cancelled.
 * @since 0.1.0
 */
export const FunctionCancelled = InngestEvent.make(
  "inngest/function.cancelled",
  Schema.Struct({
    function_id: Schema.String,
    run_id: Schema.String,
    correlation_id: Schema.optional(Schema.String),
  }),
);

/**
 * Sent when a function is invoked via step.invoke().
 * @since 0.1.0
 */
export const FunctionInvoked = InngestEvent.make(
  "inngest/function.invoked",
  Schema.Struct({
    data: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
  }),
);

/**
 * Sent when a cron trigger fires.
 * @since 0.1.0
 */
export const ScheduledTimer = InngestEvent.make(
  "inngest/scheduled.timer",
  Schema.Struct({
    cron: Schema.String,
  }),
);
