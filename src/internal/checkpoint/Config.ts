import { Duration, Predicate, Schema } from "effect";
import { InngestDuration } from "../wire/Duration.js";

export type CheckpointingOption =
  | boolean
  | {
      readonly bufferedSteps?: number;
      readonly maxInterval?: Duration.Input;
      readonly maxRuntime?: Duration.Input;
    };

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
