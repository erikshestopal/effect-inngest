import { Context, DateTime, Duration, Effect, Option, Schema } from "effect";
import type { InngestFunction } from "../../../Function.js";
import type { SendEventError, StepError } from "../../../internal/errors.js";
import type * as EventPayload from "../codec/EventPayload.js";
import type { StepInput } from "../domain/StepInput.js";

export type JsonSchema<A = unknown> = Schema.Codec<A, unknown, never, never>;

export interface RunOptions<S extends JsonSchema> {
  readonly schema: S;
}

export type RunOutput<A> = [A] extends [never]
  ? never
  : [A] extends [void]
    ? null
    : A extends Schema.Json
      ? A
      : Schema.Json;

export interface WaitForEventOptions {
  readonly timeout: Duration.Input;
  readonly if?: string;
}

export interface InvokeOptionsBase<F extends InngestFunction.Any> {
  readonly function: F;
  readonly user?: Record<string, unknown>;
  readonly v?: string;
  readonly timeout?: Duration.Input;
}

export type InvokeOptions<F extends InngestFunction.Any> = [InngestFunction.EventType<F>] extends [never]
  ? InvokeOptionsBase<F>
  : InvokeOptionsBase<F> & { readonly data: InngestFunction.EventType<F> };

export type TaggedEvent = { readonly _tag: string };

export interface Run {
  <A, Err, R>(id: StepInput, effect: Effect.Effect<A, Err, R>): Effect.Effect<RunOutput<A>, StepError | Err, R>;
  <S extends JsonSchema, Err, R>(
    id: StepInput,
    effect: Effect.Effect<Schema.Schema.Type<S>, Err, R>,
    options: RunOptions<S>,
  ): Effect.Effect<Schema.Schema.Type<S>, StepError | Err, R>;
}

export interface Sleep {
  (id: StepInput, duration: Duration.Input): Effect.Effect<void>;
}

export interface SleepUntil {
  (id: StepInput, timestamp: DateTime.Utc): Effect.Effect<void>;
}

export interface WaitForEvent {
  <A>(
    id: StepInput,
    event: EventPayload.EventSchema<A>,
    options: WaitForEventOptions,
  ): Effect.Effect<Option.Option<A>, StepError>;
}

export interface Invoke {
  <F extends InngestFunction.Any>(
    id: StepInput,
    options: InvokeOptions<F>,
  ): Effect.Effect<InngestFunction.Success<F>, StepError>;
}

export interface SendEvent {
  (
    id: StepInput,
    payload: TaggedEvent | ReadonlyArray<TaggedEvent>,
  ): Effect.Effect<{ readonly ids: ReadonlyArray<string> }, SendEventError>;
}

export declare namespace StepTools {
  export interface Service {
    readonly run: Run;
    readonly sleep: Sleep;
    readonly sleepUntil: SleepUntil;
    readonly waitForEvent: WaitForEvent;
    readonly invoke: Invoke;
    readonly sendEvent: SendEvent;
  }
}

export class StepTools extends Context.Service<StepTools, StepTools.Service>()(
  "effect-inngest/internal/runtime/StepTools",
) {}
