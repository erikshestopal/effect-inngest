/**
 * @since 0.1.0
 */
import { Array as Arr, Duration, Predicate, Schema } from "effect";
import { pipeArguments, type Pipeable } from "effect/Pipeable";
import * as Checkpoint from "./internal/checkpoint.js";
import type { CheckpointingOption } from "./internal/checkpoint.js";
import { InngestDuration } from "./next/internal/wire/Duration.js";
import type * as InngestEvent from "./Event.js";

export type { CheckpointingOption } from "./internal/checkpoint.js";

/**
 * @since 0.1.0
 * @category type ids
 */
export const TypeId: unique symbol = Symbol.for("effect-inngest/Function");

/**
 * @since 0.1.0
 * @category type ids
 */
export type TypeId = typeof TypeId;

type EventSchema = InngestEvent.EventDefinition;

/**
 * An event-based trigger configuration.
 *
 * @since 0.1.0
 * @category triggers
 */
export interface EventTrigger<E extends EventSchema = EventSchema> {
  readonly event: E;
  readonly if?: string;
}

/**
 * A cron-based trigger configuration.
 *
 * @since 0.1.0
 * @category triggers
 */
export interface CronTrigger {
  readonly cron: string;
}

/**
 * A trigger configuration for a function.
 *
 * @since 0.1.0
 * @category triggers
 */
export type Trigger<E extends EventSchema = EventSchema> = EventTrigger<E> | CronTrigger;

/**
 * @since 0.1.0
 * @category triggers
 */
export type TriggerInput<E extends EventSchema = EventSchema> = Trigger<E> | ReadonlyArray<Trigger<E>>;

interface ConcurrencyOption {
  /**
   * The concurrency limit for this option, adding a limit on how many concurrent
   * steps can execute at once.
   */
  readonly limit: number;

  /**
   * An optional concurrency key, as an expression using the common expression language
   * (CEL). The result of this expression is used to create new concurrency groups, or
   * sub-queues, for each function run.
   *
   * The event is passed into this expression as "event".
   *
   * Examples:
   * - `event.data.user_id`: this evaluates to the user_id in the event.data object.
   * - `event.data.user_id + "-" + event.data.account_id`: creates a new group per user/account
   * - `"ai"`: references a custom string
   */
  readonly key?: string;

  /**
   * An optional scope for the concurrency group. By default, concurrency limits are
   * scoped to functions - one function's concurrency limits do not impact other functions.
   *
   * Changing this "scope" allows concurrency limits to work across environments (eg. production
   * vs branch environments) or across your account (global).
   */
  readonly scope?: "fn" | "env" | "account";
}

interface RateLimitOption {
  /**
   * An optional key to use for rate limiting, similar to idempotency.
   */
  readonly key?: string;

  /**
   * The number of times to allow the function to run per the given `period`.
   */
  readonly limit: number;

  /**
   * The period of time to allow the function to run `limit` times.
   */
  readonly period: Duration.Input;
}

interface ThrottleOption {
  /**
   * An optional expression which returns a throttling key for controlling throttling.
   * Every unique key is its own throttle limit. Event data may be used within this
   * expression, eg "event.data.user_id".
   */
  readonly key?: string;

  /**
   * The total number of runs allowed to start within the given `period`. The limit is
   * applied evenly over the period.
   */
  readonly limit: number;

  /**
   * The period of time for the rate limit. Run starts are evenly spaced through
   * the given period. The minimum granularity is 1 second.
   */
  readonly period: Duration.Input;

  /**
   * The number of runs allowed to start in the given window in a single burst.
   * A burst > 1 bypasses smoothing for the burst and allows many runs to start
   * at once, if desired. Defaults to 1, which disables bursting.
   */
  readonly burst?: number;
}

interface DebounceOption {
  /**
   * An optional key to use for debouncing.
   */
  readonly key?: string;

  /**
   * The period of time to delay after receiving the last trigger to run the function.
   */
  readonly period: Duration.Input;

  /**
   * The maximum time that a debounce can be extended before running.
   * If events are continually received within the given period, a function
   * will always run after the given timeout period.
   */
  readonly timeout?: Duration.Input;
}

interface BatchEventsOption {
  /**
   * The maximum number of events to be consumed in one batch.
   */
  readonly maxSize: number;

  /**
   * How long to wait before invoking the function with a list of events.
   * If timeout is reached, the function will be invoked with a batch
   * even if it's not filled up to `maxSize`.
   */
  readonly timeout: Duration.Input;

  /**
   * An optional key to use for batching.
   */
  readonly key?: string;

  /**
   * An optional boolean expression to determine an event's eligibility for batching.
   */
  readonly if?: string;
}

interface PriorityOption {
  /**
   * An expression to use to determine the priority of a function run. The
   * expression can return a number between `-600` and `600`, where `600`
   * declares that this run should be executed before any others enqueued in
   * the last 600 seconds (10 minutes), and `-600` declares that this run
   * should be executed after any others enqueued in the last 600 seconds.
   */
  readonly run?: string;
}

interface TimeoutsOption {
  /**
   * Start represents the timeout for starting a function. If the time
   * between scheduling and starting a function exceeds this value, the
   * function will be cancelled.
   *
   * This is, essentially, the amount of time that a function sits in the
   * queue before starting.
   */
  readonly start?: Duration.Input;

  /**
   * Finish represents the time between a function starting and the function
   * finishing. If a function takes longer than this time to finish, the
   * function is marked as cancelled.
   */
  readonly finish?: Duration.Input;
}

interface SingletonOption {
  /**
   * An optional key expression used to scope singleton execution.
   * Each unique key has its own singleton lock. Event data can be referenced,
   * e.g. "event.data.user_id".
   */
  readonly key?: string;

  /**
   * Determines how to handle new runs when one is already active for the same key.
   * - `"skip"` skips the new run.
   * - `"cancel"` cancels the existing run and starts the new one.
   */
  readonly mode: "skip" | "cancel";
}

interface CancellationOption {
  /**
   * The name of the event that should cancel the function run.
   */
  readonly event: string;

  /**
   * The expression that must evaluate to true in order to cancel the function run. There
   * are two variables available in this expression:
   * - event, referencing the original function's event trigger
   * - async, referencing the new cancel event.
   */
  readonly if?: string;

  /**
   * An optional timeout that the cancel is valid for. If this isn't
   * specified, cancellation triggers are valid for up to a year or until the
   * function ends.
   */
  readonly timeout?: Duration.Input;
}

type Retries = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13 | 14 | 15 | 16 | 17 | 18 | 19 | 20;

/**
 * @since 0.1.0
 * @category models
 */
export interface FunctionOptions {
  /**
   * A name for the function as it will appear in the Inngest Cloud UI.
   */
  readonly name?: string;

  /**
   * A description of the function.
   */
  readonly description?: string;

  /**
   * Specifies the maximum number of retries for all steps across this function.
   * Can be a number from `0` to `20`. Defaults to `3`.
   */
  readonly retries?: Retries;

  /**
   * Concurrency specifies a limit on the total number of concurrent steps that
   * can occur across all runs of the function. A value of 0 (or undefined) means
   * use the maximum available concurrency.
   *
   * Specifying just a number means specifying only the concurrency limit. A
   * maximum of two concurrency options can be specified.
   */
  readonly concurrency?: number | ConcurrencyOption | readonly [ConcurrencyOption, ConcurrencyOption];

  /**
   * Rate limit function runs, only running them a given number of times (limit) per
   * period. Note that rate limit is a lossy, hard limit. Once the limit is hit,
   * new runs will be skipped.
   */
  readonly rateLimit?: RateLimitOption;

  /**
   * Throttles function runs, only running them a given number of times (limit) per
   * period. Once the limit is hit, new runs will be enqueued and will start when there's
   * capacity.
   */
  readonly throttle?: ThrottleOption;

  /**
   * Debounce delays functions for the `period` specified.
   */
  readonly debounce?: DebounceOption;

  /**
   * Allow the specification of an idempotency key using event data.
   */
  readonly idempotency?: string;

  /**
   * Configure how the priority of a function run is decided.
   */
  readonly priority?: PriorityOption;

  /**
   * Ensures that only one run of the function is active at a time for a given key.
   */
  readonly singleton?: SingletonOption;

  /**
   * Configuration for cancelling a function run based on incoming events.
   */
  readonly cancelOn?: ReadonlyArray<CancellationOption>;

  /**
   * Configure timeouts for the function.
   */
  readonly timeouts?: TimeoutsOption;

  /**
   * Batch events configuration.
   */
  readonly batchEvents?: BatchEventsOption;

  /**
   * Whether to use checkpointing for executions of this function. Overrides
   * the client-level `checkpointing` setting.
   *
   * - `false` disables checkpointing for this function.
   * - `true` enables checkpointing with safe defaults
   *   (`bufferedSteps: 1`, `maxInterval: 0`, `maxRuntime: 10s`).
   * - An object lets you tune `bufferedSteps`, `maxInterval`, `maxRuntime`.
   *
   * Defaults to inheriting from the client-level setting (which itself
   * defaults to enabled with safe defaults).
   */
  readonly checkpointing?: CheckpointingOption;
}

interface RegistrationConfig {
  readonly appId: string;
  readonly url: string;
}

interface FunctionRegistration {
  readonly id: string;
  readonly name: string;
  readonly triggers: ReadonlyArray<{
    event?: string;
    cron?: string;
    expression?: string;
  }>;
  readonly steps: {
    readonly step: {
      readonly id: string;
      readonly name: string;
      readonly runtime: { readonly type: "http"; readonly url: string };
      readonly retries?: { readonly attempts: number };
    };
  };
  readonly cancel?: ReadonlyArray<{
    event: string;
    if?: string;
    timeout?: string;
  }>;
  readonly timeouts?: { start?: string; finish?: string };
  readonly rateLimit?: {
    readonly key?: string;
    readonly limit: number;
    readonly period: string;
  };
  readonly throttle?: {
    readonly key?: string;
    readonly limit: number;
    readonly period: string;
    readonly burst?: number;
  };
  readonly debounce?: {
    readonly key?: string;
    readonly period: string;
    readonly timeout?: string;
  };
  readonly concurrency?:
    | {
        readonly key?: string;
        readonly limit: number;
        readonly scope?: string;
      }
    | ReadonlyArray<{
        readonly key?: string;
        readonly limit: number;
        readonly scope?: string;
      }>;
  readonly priority?: { readonly run?: string };
  readonly singleton?: { readonly key?: string; readonly mode: string };
  readonly batchEvents?: {
    readonly maxSize: number;
    readonly timeout: string;
    readonly key?: string;
  };
  readonly idempotency?: string;
  readonly checkpoint?: {
    readonly batch_steps: number;
    readonly batch_interval: string;
    readonly max_runtime: string;
  };
}

/**
 * An Inngest function definition.
 *
 * @since 0.1.0
 * @category models
 */
export interface InngestFunction<
  Tag extends string,
  Triggers extends Trigger,
  Success extends Schema.Top,
  Options extends FunctionOptions = FunctionOptions,
> extends Pipeable {
  readonly [TypeId]: TypeId;
  readonly _tag: Tag;
  readonly key: string;
  readonly triggers: ReadonlyArray<Triggers>;
  readonly success: Success;
  readonly options: Options;
  readonly toRegistration: (config: RegistrationConfig) => FunctionRegistration;
}

/**
 * @since 0.1.0
 * @category models
 */
export declare namespace InngestFunction {
  export type Any = InngestFunction<string, Trigger, Schema.Top, FunctionOptions>;
  export type Tag<F> = F extends InngestFunction<infer T, any, any, any> ? T : never;
  export type Triggers<F> = F extends InngestFunction<any, infer T, any, any> ? T : never;
  export type Events<F> =
    F extends InngestFunction<any, infer T, any, any> ? (T extends EventTrigger<infer E> ? E : never) : never;
  export type EventPayload<F> = InngestEvent.EventType<Events<F>>;
  export type EventType<F> =
    Options<F> extends { readonly batchEvents: BatchEventsOption } ? ReadonlyArray<EventPayload<F>> : EventPayload<F>;

  export type Success<F> = F extends InngestFunction<any, any, infer S, any> ? Schema.Schema.Type<S> : never;
  export type Options<F> = F extends InngestFunction<any, any, any, infer O> ? O : never;
}

const isEventTrigger = (t: Trigger): t is EventTrigger => Predicate.hasProperty(t, "event");

const encodeDuration = (input: Duration.Input): string =>
  Schema.encodeSync(InngestDuration)(Duration.fromInputUnsafe(input));

const Proto = {
  [TypeId]: TypeId,

  pipe() {
    return pipeArguments(this, arguments);
  },

  toRegistration(this: InngestFunction.Any, config: RegistrationConfig): FunctionRegistration {
    const triggers: Array<{
      event?: string;
      cron?: string;
      expression?: string;
    }> = [];

    for (const t of this.triggers) {
      if (isEventTrigger(t)) {
        triggers.push({ event: t.event.identifier, expression: t.if });
      } else {
        triggers.push({ cron: t.cron });
      }
    }

    const opts = this.options;
    const cancel = opts.cancelOn?.map((c) => ({
      event: c.event,
      if: c.if,
      timeout: c.timeout ? encodeDuration(c.timeout) : undefined,
    }));
    const timeouts =
      opts.timeouts?.start || opts.timeouts?.finish
        ? {
            start: opts.timeouts.start ? encodeDuration(opts.timeouts.start) : undefined,
            finish: opts.timeouts.finish ? encodeDuration(opts.timeouts.finish) : undefined,
          }
        : undefined;

    const rateLimit = opts.rateLimit
      ? {
          key: opts.rateLimit.key,
          limit: opts.rateLimit.limit,
          period: encodeDuration(opts.rateLimit.period),
        }
      : undefined;

    const throttle = opts.throttle
      ? {
          key: opts.throttle.key,
          limit: opts.throttle.limit,
          period: encodeDuration(opts.throttle.period),
          burst: opts.throttle.burst,
        }
      : undefined;

    const debounce = opts.debounce
      ? {
          key: opts.debounce.key,
          period: encodeDuration(opts.debounce.period),
          timeout: opts.debounce.timeout ? encodeDuration(opts.debounce.timeout) : undefined,
        }
      : undefined;

    const serializeConcurrencyOption = (option: ConcurrencyOption) => ({
      key: option.key,
      limit: option.limit,
      scope: option.scope,
    });

    const concurrency =
      opts.concurrency != null
        ? Predicate.isNumber(opts.concurrency)
          ? { limit: opts.concurrency }
          : Array.isArray(opts.concurrency)
            ? (opts.concurrency as readonly [ConcurrencyOption, ConcurrencyOption]).map(serializeConcurrencyOption)
            : serializeConcurrencyOption(opts.concurrency as ConcurrencyOption)
        : undefined;

    const priority = opts.priority ? { run: opts.priority.run } : undefined;
    const singleton = opts.singleton ? { key: opts.singleton.key, mode: opts.singleton.mode } : undefined;
    const batchEvents = opts.batchEvents
      ? {
          maxSize: opts.batchEvents.maxSize,
          timeout: encodeDuration(opts.batchEvents.timeout),
          key: opts.batchEvents.key,
        }
      : undefined;

    const idempotency = opts.idempotency;
    const retries = Predicate.isNotUndefined(opts.retries) ? { attempts: opts.retries } : undefined;

    // Function-level checkpoint config only — client-level default is
    // applied at runtime by the handler. Mirrors how other client defaults
    // (e.g. retries) interact with registration.
    const resolvedCheckpoint = Predicate.isNotUndefined(opts.checkpointing)
      ? Checkpoint.resolveConfig(opts.checkpointing, undefined)
      : undefined;
    const checkpoint = resolvedCheckpoint ? Checkpoint.toRegistration(resolvedCheckpoint) : undefined;

    const fnId = `${config.appId}-${this._tag}`;
    const stepUrl = new URL(config.url);
    stepUrl.searchParams.set("fnId", fnId);
    stepUrl.searchParams.set("stepId", "step");

    return {
      id: fnId,
      name: opts.name ?? this._tag,
      triggers,
      steps: {
        step: {
          id: "step",
          name: "step",
          runtime: { type: "http", url: stepUrl.href },
          retries,
        },
      },
      cancel: cancel && cancel.length > 0 ? cancel : undefined,
      timeouts,
      rateLimit,
      throttle,
      debounce,
      concurrency,
      priority,
      singleton,
      batchEvents,
      idempotency,
      checkpoint,
    };
  },
};

type NormalizeTriggers<T extends TriggerInput> = T extends ReadonlyArray<Trigger> ? T[number] : T;

/**
 * @since 0.1.0
 * @category constructors
 * @example
 * ```ts
 * // Event trigger
 * const Fn1 = InngestFunction.make("Hello", {
 *   trigger: { event: HelloEvent },
 *   success: Schema.Void,
 * })
 *
 * // Event trigger with CEL filter
 * const Fn2 = InngestFunction.make("Hello", {
 *   trigger: { event: HelloEvent, if: "event.data.name != ''" },
 *   success: Schema.Void,
 * })
 *
 * // Cron trigger
 * const Fn3 = InngestFunction.make("Scheduled", {
 *   trigger: { cron: "0 * * * *" },
 *   success: Schema.Void,
 * })
 *
 * // Multiple triggers
 * const Fn4 = InngestFunction.make("Multi", {
 *   trigger: [
 *     { event: HelloEvent },
 *     { cron: "0 0 * * *" },
 *   ],
 *   success: Schema.Void,
 * })
 * ```
 */
export function make<
  const Tag extends string,
  T extends TriggerInput,
  S extends Schema.Top,
  const O extends FunctionOptions = {},
>(
  tag: Tag,
  options: { readonly trigger: T; readonly success: S } & O,
): InngestFunction<Tag, NormalizeTriggers<T>, S, O> {
  const fn = Object.create(Proto);
  fn._tag = tag;
  fn.key = `effect-inngest/Function/${tag}`;
  fn.triggers = Arr.ensure(options.trigger);
  fn.success = options.success;
  fn.options = options;
  return fn;
}
