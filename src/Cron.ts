/**
 * Public cron trigger definitions.
 *
 * @since 0.1.0
 */
import { Predicate } from "effect";

export const TypeId: unique symbol = Symbol.for("effect-inngest/Cron");
export type TypeId = typeof TypeId;

export interface CronOptions {
  readonly jitter?: string;
}

export interface CronDefinition<Schedule extends string = string> {
  readonly [TypeId]: TypeId;
  readonly cron: Schedule;
  readonly jitter?: string;
}

export function make<const Schedule extends string>(
  schedule: Schedule,
  options?: CronOptions,
): CronDefinition<Schedule> {
  return {
    [TypeId]: TypeId,
    cron: schedule,
    ...(Predicate.isNotUndefined(options?.jitter) ? { jitter: options.jitter } : {}),
  };
}

export const isCron = (value: unknown): value is CronDefinition =>
  Predicate.hasProperty(value, TypeId) && value[TypeId] === TypeId;
