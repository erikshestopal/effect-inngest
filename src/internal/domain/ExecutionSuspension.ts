import { Option, Schema } from "effect";
import type * as Checkpoint from "../checkpoint.js";
import * as Protocol from "../protocol.js";
import type * as StepCommand from "./StepCommand.js";

export type GeneratorOpcode = typeof Protocol.GeneratorOpcode.Type;

export class SuspendedCommand extends Schema.Class<SuspendedCommand>("effect-inngest/internal/domain/SuspendedCommand")(
  {
    opcode: Protocol.GeneratorOpcode,
    sequence: Schema.Option(Schema.Number),
    retryAfterMs: Schema.Option(Schema.Number),
  },
) {
  static fromPlanned(planned: Checkpoint.PlannedOpcode): SuspendedCommand {
    return SuspendedCommand.make({
      opcode: planned.opcode,
      sequence: Option.some(planned.sequence),
      retryAfterMs: Option.none(),
    });
  }

  static fromOpcode(opcode: GeneratorOpcode, retryAfterMs: Option.Option<number> = Option.none()): SuspendedCommand {
    return SuspendedCommand.make({ opcode, sequence: Option.none(), retryAfterMs });
  }

  static fromFailure(failure: StepCommand.Failure): SuspendedCommand {
    return SuspendedCommand.make({
      opcode: failure.opcode,
      sequence: Option.none(),
      retryAfterMs: failure.retryAfterMs,
    });
  }
}

export class ExecutionSuspension extends Schema.Class<ExecutionSuspension>(
  "effect-inngest/internal/domain/ExecutionSuspension",
)({
  completed: Schema.Array(Protocol.GeneratorOpcode),
  opcodes: Schema.Array(Protocol.GeneratorOpcode),
  suspendedCount: Schema.Number,
  retryAfterMs: Schema.Option(Schema.Number),
}) {
  static from(args: {
    readonly completed: ReadonlyArray<GeneratorOpcode>;
    readonly suspended: ReadonlyArray<SuspendedCommand>;
  }): ExecutionSuspension {
    const suspended = args.suspended.toSorted((a, b) => {
      if (Option.isNone(a.sequence) || Option.isNone(b.sequence)) {
        return 0;
      }
      return a.sequence.value - b.sequence.value;
    });
    const opcodes = [...args.completed, ...suspended.map((entry) => entry.opcode)];
    return ExecutionSuspension.make({
      completed: [...args.completed],
      opcodes,
      suspendedCount: args.suspended.length,
      retryAfterMs: suspended.find((entry) => Option.isSome(entry.retryAfterMs))?.retryAfterMs ?? Option.none(),
    });
  }
}
