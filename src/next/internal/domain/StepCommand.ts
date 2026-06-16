import { Schema } from "effect";
import { StepInfo } from "./StepInfo.js";

export class Sleep extends Schema.TaggedClass<Sleep>()("Sleep", {
  info: StepInfo,
  duration: Schema.String,
}) {}

export class WaitForEvent extends Schema.TaggedClass<WaitForEvent>()("WaitForEvent", {
  info: StepInfo,
  event: Schema.String,
  timeout: Schema.String,
  if: Schema.optional(Schema.String),
}) {}

export class InvokeFunction extends Schema.TaggedClass<InvokeFunction>()("InvokeFunction", {
  info: StepInfo,
  functionId: Schema.String,
  payload: Schema.Unknown,
  timeout: Schema.optional(Schema.String),
}) {}

export class StepRunResult extends Schema.TaggedClass<StepRunResult>()("StepRunResult", {
  info: StepInfo,
  data: Schema.Unknown,
}) {}

export class SendEventResult extends Schema.TaggedClass<SendEventResult>()("SendEventResult", {
  info: StepInfo,
  data: Schema.Struct({ ids: Schema.Array(Schema.String) }),
  rawPayload: Schema.Unknown,
}) {}

export class StepRunPlanned extends Schema.TaggedClass<StepRunPlanned>()("StepRunPlanned", {
  info: StepInfo,
}) {}

export class SendEventPlanned extends Schema.TaggedClass<SendEventPlanned>()("SendEventPlanned", {
  info: StepInfo,
}) {}

export class StepRunError extends Schema.TaggedClass<StepRunError>()("StepRunError", {
  info: StepInfo,
  error: Schema.Unknown,
  noRetry: Schema.optional(Schema.Boolean),
  retryAfterMs: Schema.optional(Schema.Number),
}) {}

export class StepRunFailed extends Schema.TaggedClass<StepRunFailed>()("StepRunFailed", {
  info: StepInfo,
  error: Schema.Unknown,
}) {}

export type YieldCommand = Sleep | WaitForEvent | InvokeFunction;
export type ResultCommand = StepRunResult | SendEventResult;
export type PlanCommand = YieldCommand | StepRunPlanned | SendEventPlanned;
export type ErrorCommand = StepRunError | StepRunFailed;
export type StepCommand = YieldCommand | ResultCommand | PlanCommand | ErrorCommand;
