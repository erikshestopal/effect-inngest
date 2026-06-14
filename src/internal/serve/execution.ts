/**
 * SDK execution request interpreter boundary.
 * @internal
 */
import * as Schema from "effect/Schema";

export class FunctionExecutionNotFound extends Schema.TaggedErrorClass<FunctionExecutionNotFound>()(
  "FunctionExecutionNotFound",
  {
    fnId: Schema.String,
  },
) {}

export class ExecutionFailed extends Schema.TaggedErrorClass<ExecutionFailed>()("ExecutionFailed", {
  message: Schema.String,
}) {}
