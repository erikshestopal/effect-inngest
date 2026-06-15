/**
 * SDK execution request interpreter boundary.
 * @internal
 */
import { Schema } from "effect";

export class FunctionExecutionNotFound extends Schema.TaggedErrorClass<FunctionExecutionNotFound>()(
  "FunctionExecutionNotFound",
  {
    fnId: Schema.String,
  },
) {}

export class ExecutionFailed extends Schema.TaggedErrorClass<ExecutionFailed>()("ExecutionFailed", {
  message: Schema.String,
}) {}
