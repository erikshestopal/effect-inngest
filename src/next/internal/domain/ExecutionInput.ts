import { Context, Equal, Option, Schema } from "effect";
import type * as Protocol from "../../../internal/protocol.js";
import * as Memo from "./Memo.js";
import type { StepInfo } from "./StepInfo.js";

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
  requestedStepHash: Schema.Option(Schema.String),
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
      requestedStepHash: request.ctx.step_id === "step" ? Option.none() : Option.some(request.ctx.step_id),
      disableImmediateExecution: request.ctx.disable_immediate_execution,
    });
  }

  memoForStep(info: StepInfo): Memo.Memo {
    return Memo.decode(this.steps[info.hash]);
  }

  shouldExecuteStep(info: StepInfo): boolean {
    return Option.match(this.requestedStepHash, {
      onNone: () => true,
      onSome: Equal.equals(info.hash),
    });
  }

  shouldPlanStep(info: StepInfo): boolean {
    return this.shouldExecuteStep(info) && this.isFunctionRun() && this.disableImmediateExecution;
  }

  isFunctionRun(): boolean {
    return Option.isNone(this.requestedStepHash);
  }
}

export class CurrentExecutionInput extends Context.Service<CurrentExecutionInput, ExecutionInput>()(
  "effect-inngest/internal/domain/CurrentExecutionInput",
) {}
