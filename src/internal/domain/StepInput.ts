import { Schema } from "effect";

export const StepOptions = Schema.Struct({
  id: Schema.String,
  name: Schema.optional(Schema.String),
});
export type StepOptions = typeof StepOptions.Type;

export const StepInput = Schema.Union([Schema.String, StepOptions]);
export type StepInput = typeof StepInput.Type;
