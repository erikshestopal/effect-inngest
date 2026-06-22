/**
 * Checkpoint configuration for spec §10 async checkpointing.
 *
 * Sync checkpointing (§10.3.2 / §10.4.2) is intentionally out of scope —
 * it requires a durable endpoint primitive the SDK does not yet expose.
 *
 * @internal
 */
import { Duration, Predicate, Schema } from "effect";
import { InngestDuration } from "../wire/Duration.js";

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
  maxInterval: Predicate.isNotUndefined(option.maxInterval)
    ? Duration.fromInputUnsafe(option.maxInterval)
    : DEFAULTS.maxInterval,
  maxRuntime: Predicate.isNotUndefined(option.maxRuntime)
    ? Duration.fromInputUnsafe(option.maxRuntime)
    : DEFAULTS.maxRuntime,
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
  if (fnLevel === false) {
    return undefined;
  }
  // Per the `CheckpointingOption` docstring, `true` means "enable with safe
  // defaults" — it never inherits a client-level object. Explicit object at
  // the fn level overrides everything; otherwise fall through to client.
  if (fnLevel === true) {
    return DEFAULTS;
  }
  if (Predicate.isNotUndefined(fnLevel)) {
    return normalize(fnLevel);
  }
  // fnLevel === undefined — use client-level
  if (clientLevel === false) {
    return undefined;
  }
  if (clientLevel === true) {
    return DEFAULTS;
  }
  if (Predicate.isNotUndefined(clientLevel)) {
    return normalize(clientLevel);
  }
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
  batch_interval: Schema.encodeSync(InngestDuration)(cfg.maxInterval),
  max_runtime: Schema.encodeSync(InngestDuration)(cfg.maxRuntime),
});
