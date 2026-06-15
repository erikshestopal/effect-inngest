import { Schema } from "effect";

export class StepInfo extends Schema.Class<StepInfo>("effect-inngest/internal/domain/StepInfo")({
  id: Schema.String,
  name: Schema.String,
  hash: Schema.String,
  order: Schema.Number,
  rawStepArg: Schema.Unknown,
}) {}
