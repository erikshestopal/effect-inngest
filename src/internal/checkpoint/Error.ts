import { Schema } from "effect";

export class CheckpointApiError extends Schema.TaggedError<CheckpointApiError>()("CheckpointApiError", {
  message: Schema.String,
  status: Schema.optionalKey(Schema.Number),
}) {}
