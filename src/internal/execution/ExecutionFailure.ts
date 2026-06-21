import { Cause, Option, Schema } from "effect";
import * as Protocol from "../protocol.js";

export class ExecutionFailure extends Schema.Class<ExecutionFailure>(
  "effect-inngest/internal/execution/ExecutionFailure",
)({
  error: Schema.Unknown,
}) {
  static fromCause(cause: Cause.Cause<unknown>): ExecutionFailure {
    return ExecutionFailure.make({ error: ExecutionFailure.errorFromCause(cause) });
  }

  private static errorFromCause(cause: Cause.Cause<unknown>): unknown {
    return Option.orElse(Cause.findErrorOption(cause), () => {
      const dieReason = cause.reasons.find(Cause.isDieReason);
      return dieReason ? Option.some(dieReason.defect) : Option.none();
    }).pipe(Option.getOrElse(() => Protocol.UserError.make({ name: "Error", message: "Unknown error" })));
  }
}
