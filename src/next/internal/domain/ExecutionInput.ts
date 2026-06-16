import { Context, Schema } from "effect";
import type * as Protocol from "../../../internal/protocol.js";

export class ExecutionEvent extends Schema.Class<ExecutionEvent>("effect-inngest/internal/domain/ExecutionEvent")({
  id: Schema.optional(Schema.String),
  name: Schema.String,
  data: Schema.NullOr(Schema.Record(Schema.String, Schema.Unknown)),
  ts: Schema.optional(Schema.Number),
  user: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
  v: Schema.optional(Schema.String),
}) {}

export class RunContext extends Schema.Class<RunContext>("effect-inngest/internal/domain/RunContext")({
  id: Schema.String,
  attempt: Schema.Number,
  maxAttempts: Schema.Number,
}) {}

export class ExecutionInput extends Schema.Class<ExecutionInput>("effect-inngest/internal/domain/ExecutionInput")({
  event: ExecutionEvent,
  events: Schema.Array(ExecutionEvent),
  steps: Schema.Record(Schema.String, Schema.Unknown),
  run: RunContext,
  stepId: Schema.String,
  disableImmediateExecution: Schema.Boolean,
}) {
  static fromSdkRequestBody(request: Protocol.SDKRequestBody) {
    return ExecutionInput.make({
      event: ExecutionEvent.make(request.event),
      events: request.events.map((event) => ExecutionEvent.make(event)),
      steps: request.steps,
      run: RunContext.make({
        id: request.ctx.run_id,
        attempt: request.ctx.attempt,
        maxAttempts: request.ctx.max_attempts,
      }),
      stepId: request.ctx.step_id,
      disableImmediateExecution: request.ctx.disable_immediate_execution,
    });
  }
}

export class CurrentExecutionInput extends Context.Service<CurrentExecutionInput, ExecutionInput>()(
  "effect-inngest/internal/domain/CurrentExecutionInput",
) {}
