import { Schema } from "effect";

export class CheckpointApiError extends Schema.TaggedErrorClass<CheckpointApiError>()("CheckpointApiError", {
  message: Schema.String,
  status: Schema.optionalKey(Schema.Number),
}) {}
