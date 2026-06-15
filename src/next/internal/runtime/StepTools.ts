import { Context, DateTime, Duration, Effect, Layer, Option, Schema, pipe } from "effect";
import { InngestClient } from "../../../Client.js";
import type { InngestFunction } from "../../../Function.js";
import type { SendEventError, StepError } from "../../../internal/errors.js";
import type { CheckpointState } from "../../../internal/checkpoint.js";
import type * as EventPayload from "../codec/EventPayload.js";
import type { ExecutionInput } from "../domain/ExecutionInput.js";
import type { StepInput } from "../domain/StepInput.js";
import { EventApi, type OutgoingEvent } from "./EventApi.js";
import { StepCommandSink } from "./StepCommandSink.js";
import { StepIdentity } from "./StepIdentity.js";
import * as InvokeStep from "./steps/InvokeStep.js";
import * as SendEventStep from "./steps/SendEventStep.js";
import * as SleepStep from "./steps/SleepStep.js";
import * as SleepUntilStep from "./steps/SleepUntilStep.js";
import * as StepRun from "./steps/StepRun.js";
import * as WaitForEventStep from "./steps/WaitForEventStep.js";

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
    payload: OutgoingEvent | ReadonlyArray<OutgoingEvent>,
  ): Effect.Effect<{ readonly ids: ReadonlyArray<string> }, SendEventError, InngestClient>;
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
) {
  static readonly layer = (args: {
    readonly input: ExecutionInput;
    readonly appName: string;
    readonly checkpoint: Option.Option<CheckpointState>;
  }) =>
    Layer.effect(
      this,
      Effect.gen(function* () {
        const identity = yield* StepIdentity;
        const sink = yield* StepCommandSink;
        const eventApi = yield* EventApi;
        const runtime = pipe(
          Context.make(StepIdentity, identity),
          Context.add(StepCommandSink, sink),
          Context.add(EventApi, eventApi),
        );

        return {
          run: ((id, effect, options) =>
            StepRun.run({ input: args.input, id, effect, options }).pipe(Effect.provide(runtime))) as Run,
          sleep: ((id, duration) =>
            SleepStep.sleep({ input: args.input, id, duration }).pipe(Effect.provide(runtime))) as Sleep,
          sleepUntil: ((id, timestamp) =>
            SleepUntilStep.sleepUntil({ input: args.input, id, timestamp }).pipe(
              Effect.provide(runtime),
            )) as SleepUntil,
          waitForEvent: ((id, event, options) =>
            WaitForEventStep.waitForEvent({ input: args.input, id, event, options }).pipe(
              Effect.provide(runtime),
            )) as WaitForEvent,
          invoke: ((id, options) =>
            InvokeStep.invoke({ input: args.input, appName: args.appName, id, options }).pipe(
              Effect.provide(runtime),
            )) as Invoke,
          sendEvent: ((id, payload) =>
            SendEventStep.sendEvent({ input: args.input, id, payload }).pipe(Effect.provide(runtime))) as SendEvent,
        };
      }),
    ).pipe(
      Layer.provide(StepIdentity.layer),
      Layer.provide(StepCommandSink.layer({ checkpoint: args.checkpoint })),
      Layer.provide(EventApi.layer),
    );
}
