import { Array as Arr, Context, Effect, Layer, Option, Ref } from "effect";
import { ExecutionSuspension, SuspendedCommand, type GeneratorOpcode } from "../domain/ExecutionSuspension.js";
import * as StepCommand from "../domain/StepCommand.js";
import { CurrentCheckpoint } from "./CheckpointContext.js";

export declare namespace StepCommandBus {
  export interface Service {
    readonly suspend: (command: StepCommand.YieldCommand) => Effect.Effect<void>;
    readonly complete: (command: StepCommand.ResultCommand) => Effect.Effect<void>;
    readonly plan: (command: StepCommand.PlanCommand) => Effect.Effect<void>;
    readonly fail: (command: StepCommand.ErrorCommand) => Effect.Effect<void>;
    readonly takePlanned: () => Effect.Effect<ReadonlyArray<GeneratorOpcode>>;
    readonly takeCompleted: () => Effect.Effect<ReadonlyArray<GeneratorOpcode>>;
    readonly takeSuspension: () => Effect.Effect<ExecutionSuspension>;
  }
}

const plannedFromCheckpoint = CurrentCheckpoint.pipe(
  Effect.flatMap(
    Option.match({
      onNone: () => Effect.succeed([] as ReadonlyArray<GeneratorOpcode>),
      onSome: (state) => state.takePlanned(),
    }),
  ),
);

const completedFromCheckpoint = CurrentCheckpoint.pipe(
  Effect.flatMap(
    Option.match({
      onNone: () => Effect.succeed([] as ReadonlyArray<GeneratorOpcode>),
      onSome: (state) => state.takeCompleted(),
    }),
  ),
);

export class StepCommandBus extends Context.Service<StepCommandBus, StepCommandBus.Service>()(
  "effect-inngest/internal/runtime/StepCommandBus",
) {
  static readonly make = Effect.gen(function* () {
    const suspended = yield* Ref.make(Arr.empty<SuspendedCommand>());

    const suspendExecution = (command: SuspendedCommand) =>
      Ref.update(suspended, Arr.append(command)).pipe(Effect.andThen(Effect.interrupt));

    const takeSuspended = Ref.modify(suspended, (current) => [current, Arr.empty<SuspendedCommand>()]);

    const takeSuspension = () =>
      Effect.gen(function* () {
        const completed = yield* completedFromCheckpoint;
        const commands = yield* takeSuspended;
        return ExecutionSuspension.from({ completed, suspended: commands });
      });

    return StepCommandBus.of({
      suspend: (command) =>
        Effect.gen(function* () {
          const checkpoint = yield* CurrentCheckpoint;
          if (Option.isSome(checkpoint)) {
            yield* checkpoint.value.flush;
          }
          return yield* suspendExecution(SuspendedCommand.fromPlanned(StepCommand.plan(command)));
        }),
      complete: (command) =>
        Effect.gen(function* () {
          const checkpoint = yield* CurrentCheckpoint;
          if (Option.isNone(checkpoint)) {
            return yield* suspendExecution(SuspendedCommand.fromOpcode(StepCommand.completion(command)));
          }
          return yield* checkpoint.value.record(StepCommand.checkpoint(command));
        }),
      plan: (command) =>
        Effect.gen(function* () {
          const checkpoint = yield* CurrentCheckpoint;
          const planned = StepCommand.plan(command);
          if (Option.isNone(checkpoint)) {
            return yield* suspendExecution(SuspendedCommand.fromPlanned(planned));
          }
          return yield* checkpoint.value.plan(planned);
        }),
      fail: (command) => suspendExecution(SuspendedCommand.fromFailure(StepCommand.failure(command))),
      takePlanned: () => plannedFromCheckpoint,
      takeCompleted: () => completedFromCheckpoint,
      takeSuspension,
    });
  });

  static readonly layer = Layer.effect(this, this.make);
}
