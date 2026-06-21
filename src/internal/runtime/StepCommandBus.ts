import { Context, Effect, Layer, Option, Predicate, Ref, Schema } from "effect";
import * as Protocol from "../protocol.js";
import * as StepCommandOpcode from "../codec/StepCommandOpcode.js";
import * as StepCommand from "../domain/StepCommand.js";
import { CurrentCheckpoint } from "./CheckpointContext.js";

type GeneratorOpcode = typeof Protocol.GeneratorOpcode.Type;

export class SuspendedCommand extends Schema.Class<SuspendedCommand>(
  "effect-inngest/internal/runtime/SuspendedCommand",
)({
  opcode: Protocol.GeneratorOpcode,
  retryAfterMs: Schema.Option(Schema.Number),
}) {}

export declare namespace StepCommandBus {
  export interface InterruptedCommands {
    readonly completed: ReadonlyArray<GeneratorOpcode>;
    readonly opcodes: ReadonlyArray<GeneratorOpcode>;
    readonly suspendedCount: number;
    readonly retryAfterMs: Option.Option<number>;
    readonly hasRetriableStepError: boolean;
    readonly hasNonRetriableError: boolean;
  }

  export interface Service {
    readonly suspend: (command: StepCommand.YieldCommand) => Effect.Effect<void>;
    readonly complete: (command: StepCommand.ResultCommand) => Effect.Effect<void>;
    readonly plan: (command: StepCommand.PlanCommand) => Effect.Effect<void>;
    readonly fail: (command: StepCommand.ErrorCommand) => Effect.Effect<void>;
    readonly planned: Effect.Effect<ReadonlyArray<GeneratorOpcode>>;
    readonly completed: Effect.Effect<ReadonlyArray<GeneratorOpcode>>;
    readonly interrupted: Effect.Effect<InterruptedCommands>;
  }
}

const hasNonRetriableError = (opcodes: ReadonlyArray<GeneratorOpcode>): boolean =>
  opcodes.some(
    (op) =>
      op.op === Protocol.Opcode.StepFailed ||
      (op.op === Protocol.Opcode.StepError &&
        Predicate.isObject(op.error) &&
        Predicate.hasProperty(op.error, "noRetry") &&
        op.error.noRetry === true),
  );

const hasRetriableStepError = (opcodes: ReadonlyArray<GeneratorOpcode>): boolean =>
  opcodes.some((op) => op.op === Protocol.Opcode.StepError);

const summarizeInterrupted = (
  completed: ReadonlyArray<GeneratorOpcode>,
  suspended: ReadonlyArray<SuspendedCommand>,
): StepCommandBus.InterruptedCommands => {
  const opcodes = [...completed, ...suspended.map((entry) => entry.opcode)];
  return {
    completed,
    opcodes,
    suspendedCount: suspended.length,
    retryAfterMs: suspended.find((entry) => Option.isSome(entry.retryAfterMs))?.retryAfterMs ?? Option.none(),
    hasRetriableStepError: hasRetriableStepError(opcodes),
    hasNonRetriableError: hasNonRetriableError(opcodes),
  };
};

const plannedFromCheckpoint = CurrentCheckpoint.pipe(
  Effect.flatMap(
    Option.match({
      onNone: () => Effect.succeed([] as ReadonlyArray<GeneratorOpcode>),
      onSome: (state) => state.drainPlanned,
    }),
  ),
);

const completedFromCheckpoint = CurrentCheckpoint.pipe(
  Effect.flatMap(
    Option.match({
      onNone: () => Effect.succeed([] as ReadonlyArray<GeneratorOpcode>),
      onSome: (state) => state.drain,
    }),
  ),
);

export class StepCommandBus extends Context.Service<StepCommandBus, StepCommandBus.Service>()(
  "effect-inngest/internal/runtime/StepCommandBus",
) {
  static readonly make = Effect.gen(function* () {
    const suspended = yield* Ref.make<Array<SuspendedCommand>>([]);

    const interruptWith = (args: { readonly opcode: GeneratorOpcode; readonly retryAfterMs?: Option.Option<number> }) =>
      Ref.update((current: Array<SuspendedCommand>) => [
        ...current,
        SuspendedCommand.make({ opcode: args.opcode, retryAfterMs: args.retryAfterMs ?? Option.none() }),
      ])(suspended).pipe(Effect.andThen(Effect.interrupt));

    const takeSuspended = Ref.modify(suspended, (current) => [current, [] as Array<SuspendedCommand>]);

    const interrupted = Effect.gen(function* () {
      const completed = yield* completedFromCheckpoint;
      const commands = yield* takeSuspended;
      return summarizeInterrupted(completed, commands);
    });

    return {
      suspend: (command: StepCommand.YieldCommand) =>
        Effect.gen(function* () {
          const checkpoint = yield* CurrentCheckpoint;
          if (Option.isSome(checkpoint)) {
            yield* checkpoint.value.flush;
          }
          return yield* interruptWith({ opcode: StepCommandOpcode.yielded(command) });
        }),
      complete: (command: StepCommand.ResultCommand) =>
        Effect.gen(function* () {
          const checkpoint = yield* CurrentCheckpoint;
          if (Option.isNone(checkpoint)) {
            return yield* interruptWith({ opcode: StepCommandOpcode.response(command) });
          }
          return yield* checkpoint.value.bufferStep(StepCommandOpcode.checkpointedResponse(command));
        }),
      plan: (command: StepCommand.PlanCommand) =>
        Effect.gen(function* () {
          const checkpoint = yield* CurrentCheckpoint;
          const planned = StepCommandOpcode.planned(command);
          if (Option.isNone(checkpoint)) {
            return yield* interruptWith({ opcode: planned.opcode });
          }
          return yield* checkpoint.value.planOpcode(planned.opcode, planned.order);
        }),
      fail: (command: StepCommand.ErrorCommand) => {
        const failed = StepCommandOpcode.failure(command);
        return interruptWith({ opcode: failed.opcode, retryAfterMs: failed.retryAfterMs });
      },
      planned: plannedFromCheckpoint,
      completed: completedFromCheckpoint,
      interrupted,
    };
  });

  static readonly layer = Layer.effect(this, this.make);
}
