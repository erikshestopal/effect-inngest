import { Array as Arr, Clock, Duration, Effect, Option, Ref, Result } from "effect";
import type { CheckpointConfig } from "./Config.js";
import type { CheckpointApiError } from "./Error.js";
import type * as StepCommand from "../domain/StepCommand.js";
import type * as Protocol from "../protocol.js";

export interface CheckpointState {
  readonly config: CheckpointConfig;
  readonly runId: string;
  readonly fnId: string;
  readonly qiId: string;
  readonly plan: (planned: StepCommand.PlannedOpcode) => Effect.Effect<void>;
  readonly takePlanned: () => Effect.Effect<ReadonlyArray<typeof Protocol.GeneratorOpcode.Type>>;
  readonly record: (op: typeof Protocol.GeneratorOpcode.Type) => Effect.Effect<void>;
  readonly flush: Effect.Effect<void>;
  readonly takeCompleted: () => Effect.Effect<ReadonlyArray<typeof Protocol.GeneratorOpcode.Type>>;
  readonly markRuntimeExceeded: Effect.Effect<void>;
  readonly isRuntimeExceeded: Effect.Effect<boolean>;
}

export const make = (args: {
  readonly config: CheckpointConfig;
  readonly runId: string;
  readonly fnId: string;
  readonly qiId: string;
  readonly checkpointAsync: (
    steps: ReadonlyArray<typeof Protocol.GeneratorOpcode.Type>,
  ) => Effect.Effect<void, CheckpointApiError>;
}): Effect.Effect<CheckpointState> =>
  Effect.sync(() => {
    const buffer = Ref.makeUnsafe<ReadonlyArray<typeof Protocol.GeneratorOpcode.Type>>(Arr.empty());
    const plannedBuffer = Ref.makeUnsafe<ReadonlyArray<StepCommand.PlannedOpcode>>(Arr.empty());
    const intervalStartedAt = Ref.makeUnsafe<Option.Option<number>>(Option.none());
    const runtimeExceeded = Ref.makeUnsafe(false);

    const maxIntervalMs = Duration.toMillis(args.config.maxInterval);

    // Extract-then-restore is NOT atomic across multiple fibers; a concurrent
    // `record` between the `Ref.modify` snapshot and the error-path
    // `Ref.update` restore would reorder opcodes. Request-scoped execution
    // today only runs a single fiber, so this is safe. If parallel fibers
    // are ever added here, guard `flushInner` with a `Semaphore(1)`.
    const flushInner: Effect.Effect<void> = Effect.gen(function* () {
      const steps = yield* Ref.modify(buffer, (current) => [
        current,
        Arr.empty<typeof Protocol.GeneratorOpcode.Type>(),
      ]);
      if (steps.length === 0) {
        return;
      }
      const result = yield* Effect.result(args.checkpointAsync(steps));
      if (Result.isFailure(result)) {
        // Restore at the head so subsequent `completed` includes them in the 206.
        yield* Ref.update(buffer, (current) => [...steps, ...current]);
        return;
      }
      yield* Ref.set(intervalStartedAt, Option.none());
    });

    const record = (op: typeof Protocol.GeneratorOpcode.Type): Effect.Effect<void> =>
      Effect.gen(function* () {
        const len = yield* Ref.modify(buffer, (current) => {
          const next = [...current, op];
          return [next.length, next] as const;
        });
        const now = yield* Clock.currentTimeMillis;
        const start = yield* Ref.get(intervalStartedAt);

        if (len >= args.config.bufferedSteps) {
          yield* flushInner;
          return;
        }
        if (Option.isSome(start) && maxIntervalMs > 0 && now - start.value >= maxIntervalMs) {
          yield* flushInner;
          return;
        }
        if (Option.isNone(start) && maxIntervalMs > 0) {
          yield* Ref.set(intervalStartedAt, Option.some(now));
        }
      });

    const takeCompleted = (): Effect.Effect<ReadonlyArray<typeof Protocol.GeneratorOpcode.Type>> =>
      Ref.modify(buffer, (current) => [current, Arr.empty<typeof Protocol.GeneratorOpcode.Type>()]);

    const plan = (planned: StepCommand.PlannedOpcode): Effect.Effect<void> =>
      Ref.update(plannedBuffer, (current) => [...current, planned]);

    const takePlanned = (): Effect.Effect<ReadonlyArray<typeof Protocol.GeneratorOpcode.Type>> =>
      Ref.modify(plannedBuffer, (current) => [
        [...current].sort((a, b) => a.sequence - b.sequence).map((entry) => entry.opcode),
        Arr.empty<StepCommand.PlannedOpcode>(),
      ]);

    return {
      config: args.config,
      runId: args.runId,
      fnId: args.fnId,
      qiId: args.qiId,
      plan,
      takePlanned,
      record,
      flush: flushInner,
      takeCompleted,
      markRuntimeExceeded: Ref.set(runtimeExceeded, true),
      isRuntimeExceeded: Ref.get(runtimeExceeded),
    };
  });
