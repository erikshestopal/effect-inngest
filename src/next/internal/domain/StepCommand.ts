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

export class StepPlanned extends Schema.TaggedClass<StepPlanned>()("StepPlanned", {
  info: StepInfo,
  kind: Schema.Literals(["run", "sendEvent"]),
}) {}

export type StepCommand = Sleep | WaitForEvent | InvokeFunction | StepRunResult | SendEventResult | StepPlanned;
