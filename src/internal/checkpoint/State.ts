/**
 * Per-execution checkpoint state for spec §10 async checkpointing.
 *
 * @internal
 */
import { Array as Arr, Clock, Duration, Effect, Option, Ref, Result } from "effect";
import type { CheckpointConfig } from "./Config.js";
import type { CheckpointApiError } from "./Error.js";
import type * as StepCommand from "../domain/StepCommand.js";
import type * as Protocol from "../protocol.js";

/**
 * Per-execution state for checkpoint mode. NOT a `Context.Service` — each
 * `execute` call constructs its own and passes it directly to step tools and
 * the driver.
 *
 * Internal `Ref`s are closure-private; only effectful ops are exposed. All
 * ops are safe to sequence from a single fiber; the buffer/interval/runtime
 * primitives are not designed for concurrent fibers (none are spawned today).
 */
export interface CheckpointState {
  readonly config: CheckpointConfig;
  readonly runId: string;
  readonly fnId: string;
  readonly qiId: string;
  /** Append a planned/async opcode discovered during a root parallel pass. */
  readonly plan: (planned: StepCommand.PlannedOpcode) => Effect.Effect<void>;
  /** Atomic snapshot + clear for planned opcodes; never sent via async checkpoint. */
  readonly takePlanned: () => Effect.Effect<ReadonlyArray<typeof Protocol.GeneratorOpcode.Type>>;
  /** Append a sync opcode; flush if `bufferedSteps` or `maxInterval` reached. */
  readonly record: (op: typeof Protocol.GeneratorOpcode.Type) => Effect.Effect<void>;
  /**
   * Best-effort flush. On API error the buffered steps are re-prepended so
   * `completed` can include them in the terminal 206 (no step loss per §10.4.3).
   */
  readonly flush: Effect.Effect<void>;
  /** Atomic snapshot + clear, for terminal response assembly. */
  readonly takeCompleted: () => Effect.Effect<ReadonlyArray<typeof Protocol.GeneratorOpcode.Type>>;
  /** Signal that the handler's `maxRuntime` deadline fired (spec §10.4.1 #7). */
  readonly markRuntimeExceeded: Effect.Effect<void>;
  /** Query whether the `maxRuntime` deadline fired. */
  readonly isRuntimeExceeded: Effect.Effect<boolean>;
}

/**
 * Construct a `CheckpointState`. Caller supplies a pre-bound `checkpointAsync`
 * callback (typically `(steps) => client.checkpointAsync({runId, fnId, qiId, steps})`),
 * so this module has no dependency on `InngestClient`.
 */
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
