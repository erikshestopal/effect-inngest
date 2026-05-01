/**
 * Checkpoint configuration + per-execution state for spec §10 async
 * checkpointing.
 *
 * Sync checkpointing (§10.3.2 / §10.4.2) is intentionally out of scope —
 * it requires a durable endpoint primitive the SDK does not yet expose.
 *
 * @internal
 */
import * as Clock from "effect/Clock";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import { timeStr } from "./helpers.js";
import type * as Protocol from "./protocol.js";

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

/**
 * User-facing checkpointing option, accepted on `ClientConfig.checkpointing`
 * and `FunctionOptions.checkpointing`.
 *
 * - `false` disables checkpointing entirely (no API calls; classic 206-per-step).
 * - `true` enables checkpointing with the safe defaults
 *   (`bufferedSteps: 1`, `maxInterval: 0`, `maxRuntime: 10 seconds`).
 * - An object lets you tune `bufferedSteps`, `maxInterval`, `maxRuntime`.
 */
export type CheckpointingOption =
  | boolean
  | {
      readonly bufferedSteps?: number;
      readonly maxInterval?: Duration.Input;
      readonly maxRuntime?: Duration.Input;
    };

/**
 * Resolved internal config — defaults applied, durations normalized.
 */
export interface CheckpointConfig {
  readonly bufferedSteps: number;
  readonly maxInterval: Duration.Duration;
  readonly maxRuntime: Duration.Duration;
}

const DEFAULTS: CheckpointConfig = {
  bufferedSteps: 1,
  maxInterval: Duration.millis(0),
  maxRuntime: Duration.seconds(10),
};

const normalize = (option: Exclude<CheckpointingOption, boolean>): CheckpointConfig => ({
  bufferedSteps: option.bufferedSteps ?? DEFAULTS.bufferedSteps,
  maxInterval: option.maxInterval !== undefined ? Duration.fromInputUnsafe(option.maxInterval) : DEFAULTS.maxInterval,
  maxRuntime: option.maxRuntime !== undefined ? Duration.fromInputUnsafe(option.maxRuntime) : DEFAULTS.maxRuntime,
});

/**
 * Resolve final config from function-level + client-level settings.
 *
 * Precedence: function-level explicit > client-level explicit > built-in
 * defaults (default-ON, matching the TS reference SDK).
 *
 * Returns `undefined` if either level explicitly disables checkpointing.
 */
export const resolveConfig = (
  fnLevel: CheckpointingOption | undefined,
  clientLevel: CheckpointingOption | undefined,
): CheckpointConfig | undefined => {
  if (fnLevel === false) return undefined;
  // Per the `CheckpointingOption` docstring, `true` means "enable with safe
  // defaults" — it never inherits a client-level object. Explicit object at
  // the fn level overrides everything; otherwise fall through to client.
  if (fnLevel === true) return DEFAULTS;
  if (fnLevel !== undefined) return normalize(fnLevel);
  // fnLevel === undefined — use client-level
  if (clientLevel === false) return undefined;
  if (clientLevel === true) return DEFAULTS;
  if (clientLevel !== undefined) return normalize(clientLevel);
  // Default-ON: undefined at both levels
  return DEFAULTS;
};

/**
 * Registration payload fragment per spec §10.1.1.
 */
export interface RegistrationFragment {
  readonly batch_steps: number;
  readonly batch_interval: string;
  readonly max_runtime: string;
}

export const toRegistration = (cfg: CheckpointConfig): RegistrationFragment => ({
  batch_steps: cfg.bufferedSteps,
  batch_interval: timeStr(cfg.maxInterval),
  max_runtime: timeStr(cfg.maxRuntime),
});

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
  /** Append a sync opcode; flush if `bufferedSteps` or `maxInterval` reached. */
  readonly bufferStep: (op: typeof Protocol.GeneratorOpcode.Type) => Effect.Effect<void>;
  /**
   * Best-effort flush. On API error the buffered steps are re-prepended so
   * `drain` can include them in the terminal 206 (no step loss per §10.4.3).
   */
  readonly flush: Effect.Effect<void>;
  /** Atomic snapshot + clear, for terminal response assembly. */
  readonly drain: Effect.Effect<ReadonlyArray<typeof Protocol.GeneratorOpcode.Type>>;
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
    const buffer = Ref.makeUnsafe<ReadonlyArray<typeof Protocol.GeneratorOpcode.Type>>([]);
    const intervalStartedAt = Ref.makeUnsafe<Option.Option<number>>(Option.none());
    const runtimeExceeded = Ref.makeUnsafe(false);

    const maxIntervalMs = Duration.toMillis(args.config.maxInterval);

    // Extract-then-restore is NOT atomic across multiple fibers; a concurrent
    // `bufferStep` between the `Ref.modify` snapshot and the error-path
    // `Ref.update` restore would reorder opcodes. Request-scoped execution
    // today only runs a single fiber, so this is safe. If parallel fibers
    // are ever added here, guard `flushInner` with a `Semaphore(1)`.
    const flushInner: Effect.Effect<void> = Effect.gen(function* () {
      const steps = yield* Ref.modify(buffer, (current) => [
        current,
        [] as ReadonlyArray<typeof Protocol.GeneratorOpcode.Type>,
      ]);
      if (steps.length === 0) return;
      const result = yield* Effect.result(args.checkpointAsync(steps));
      if (Result.isFailure(result)) {
        // Restore at the head so subsequent `drain` includes them in the 206.
        yield* Ref.update(buffer, (current) => [...steps, ...current]);
        return;
      }
      yield* Ref.set(intervalStartedAt, Option.none());
    });

    const bufferStep = (op: typeof Protocol.GeneratorOpcode.Type): Effect.Effect<void> =>
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

    const drain: Effect.Effect<ReadonlyArray<typeof Protocol.GeneratorOpcode.Type>> = Ref.modify(buffer, (current) => [
      current,
      [] as ReadonlyArray<typeof Protocol.GeneratorOpcode.Type>,
    ]);

    return {
      config: args.config,
      runId: args.runId,
      fnId: args.fnId,
      qiId: args.qiId,
      bufferStep,
      flush: flushInner,
      drain,
      markRuntimeExceeded: Ref.set(runtimeExceeded, true),
      isRuntimeExceeded: Ref.get(runtimeExceeded),
    };
  });
