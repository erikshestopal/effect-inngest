/** @internal */
import { Schema } from "effect";

/**
 * Tagged error returned by `InngestClient.checkpointAsync` when the API call
 * fails (network error or non-2xx after retries). The driver and step tools
 * treat this as a graceful-fallback signal — buffered steps are restored to
 * the buffer so they get included in the final 206 response.
 */
export class CheckpointApiError extends Schema.TaggedErrorClass<CheckpointApiError>()("CheckpointApiError", {
  message: Schema.String,
  status: Schema.optionalKey(Schema.Number),
}) {}
