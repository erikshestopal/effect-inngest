/**
 * Durable workflow operations for Inngest handlers.
 *
 * @since 0.1.0
 */
import { Duration, Effect, Option } from "effect";
import type { InngestClient } from "./Client.js";
import type * as InngestEvent from "./Event.js";
import type { InngestFunction } from "./Function.js";
import type * as EventPayload from "./internal/codec/EventPayload.js";
import type { StepInput } from "./internal/domain/StepInput.js";
import type { SendEventError, StepError } from "./internal/errors.js";
import {
  StepTools,
  type InvokeOptions,
  type OutgoingEvent,
  type WaitForEventOptions,
} from "./internal/runtime/StepTools.js";

/**
 * Execute an Effect as a durable, memoized step.
 *
 * @since 0.1.0
 * @category steps
 */
export const run = <A, Err, R>(
  id: StepInput,
  effect: Effect.Effect<A, Err, R>,
): Effect.Effect<A, StepError | Err, R | StepTools> => Effect.flatMap(StepTools, (step) => step.run(id, effect));

/**
 * Sleep durably for a duration.
 *
 * @since 0.1.0
 * @category steps
 */
export const sleep = (id: StepInput, duration: Duration.Input): Effect.Effect<void, never, StepTools> =>
  Effect.flatMap(StepTools, (step) => step.sleep(id, duration));

/**
 * Sleep durably until a timestamp.
 *
 * @since 0.1.0
 * @category steps
 */
export const sleepUntil = (id: StepInput, timestamp: Date | number | string): Effect.Effect<void, never, StepTools> =>
  Effect.flatMap(StepTools, (step) => step.sleepUntil(id, timestamp));

/**
 * Wait for a matching event.
 *
 * @since 0.1.0
 * @category steps
 */
export const waitForEvent = <E extends EventPayload.EventSchema>(
  id: StepInput,
  event: E,
  options: WaitForEventOptions,
): Effect.Effect<Option.Option<InngestEvent.EventType<E>>, StepError, StepTools> =>
  Effect.flatMap(StepTools, (step) => step.waitForEvent(id, event, options));

/**
 * Invoke another Inngest function.
 *
 * @since 0.1.0
 * @category steps
 */
export const invoke = <F extends InngestFunction.Any>(
  id: StepInput,
  options: InvokeOptions<F>,
): Effect.Effect<unknown, StepError, StepTools> => Effect.flatMap(StepTools, (step) => step.invoke(id, options));

/**
 * Send one or more Inngest events.
 *
 * @since 0.1.0
 * @category steps
 */
export const sendEvent = (
  id: StepInput,
  payload: OutgoingEvent | ReadonlyArray<OutgoingEvent>,
): Effect.Effect<{ readonly ids: ReadonlyArray<string> }, SendEventError, StepTools | InngestClient> =>
  Effect.flatMap(StepTools, (step) => step.sendEvent(id, payload));

export type EventType<E extends EventPayload.EventSchema> = InngestEvent.EventType<E>;
