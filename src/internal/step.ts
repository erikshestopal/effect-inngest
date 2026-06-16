/**
 * Internal step tools implementation.
 * @internal
 */
import { Duration, Effect, Layer, Option, Schema } from "effect";
import type { InngestFunction } from "../Function.js";
import type { CheckpointState } from "./checkpoint.js";
import * as Protocol from "./protocol.js";
import { StepError, SendEventError } from "./errors.js";
import { CurrentCheckpoint } from "../next/internal/runtime/CheckpointContext.js";
import { HandlerFiberScope } from "../next/internal/runtime/HandlerFiberScope.js";
import { StepCommandSink } from "../next/internal/runtime/StepCommandSink.js";
import { EventApi } from "../next/internal/runtime/EventApi.js";
import { StepIdentity } from "../next/internal/runtime/StepIdentity.js";
import { fromSdkRequestBody } from "../next/internal/domain/ExecutionInput.js";
import * as InvokeStep from "../next/internal/runtime/steps/InvokeStep.js";
import * as SendEventStep from "../next/internal/runtime/steps/SendEventStep.js";
import * as SleepStep from "../next/internal/runtime/steps/SleepStep.js";
import * as SleepUntilStep from "../next/internal/runtime/steps/SleepUntilStep.js";
import * as StepRun from "../next/internal/runtime/steps/StepRun.js";
import * as WaitForEventStep from "../next/internal/runtime/steps/WaitForEventStep.js";
import * as EventPayload from "../next/internal/codec/EventPayload.js";
import type * as InngestEvent from "../Event.js";

import { StepInterrupt, type StepInfo } from "./interrupts.js";

export { StepInterrupt, type StepInfo } from "./interrupts.js";

interface StepOptions {
  readonly id: string;
  readonly name?: string;
}

type StepOptionsOrId = string | StepOptions;

interface WaitForEventOptions {
  readonly timeout: Duration.Input;
  readonly if?: string;
}

type JsonSchema<A = unknown> = Schema.Codec<A, unknown, never, never>;
type StepRunOutput<A> = [A] extends [never]
  ? never
  : [A] extends [void]
    ? null
    : A extends Schema.Json
      ? A
      : Schema.Json;

interface StepRunOptions<S extends JsonSchema> {
  readonly schema: S;
}

interface StepRun {
  <A, Err, R>(
    id: StepOptionsOrId,
    effect: Effect.Effect<A, Err, R>,
  ): Effect.Effect<StepRunOutput<A>, StepError | Err, R>;
  <S extends JsonSchema, Err, R>(
    id: StepOptionsOrId,
    effect: Effect.Effect<Schema.Schema.Type<S>, Err, R>,
    options: StepRunOptions<S>,
  ): Effect.Effect<Schema.Schema.Type<S>, StepError | Err, R>;
}

interface InvokeOptionsBase<F extends InngestFunction.Any> {
  readonly function: F;
  readonly user?: Record<string, unknown>;
  readonly v?: string;
  readonly timeout?: Duration.Input;
}

type InvokeOptions<F extends InngestFunction.Any> = [InngestFunction.EventPayload<F>] extends [never]
  ? InvokeOptionsBase<F>
  : InvokeOptionsBase<F> & { readonly data: InngestFunction.EventPayload<F> };

type EventSchema = InngestEvent.EventDefinition;
type InngestEventPayload = InngestEvent.EventType<InngestEvent.EventDefinition>;

interface StepTools {
  readonly run: StepRun;
  readonly sleep: (id: StepOptionsOrId, duration: Duration.Input) => Effect.Effect<void>;
  readonly sleepUntil: (id: StepOptionsOrId, timestamp: Date | number | string) => Effect.Effect<void>;
  readonly waitForEvent: <E extends EventSchema>(
    id: StepOptionsOrId,
    event: E,
    options: WaitForEventOptions,
  ) => Effect.Effect<Option.Option<InngestEvent.EventType<E>>, StepError>;
  readonly invoke: <F extends InngestFunction.Any>(
    id: StepOptionsOrId,
    options: InvokeOptions<F>,
  ) => Effect.Effect<InngestFunction.Success<F>, StepError>;
  readonly sendEvent: (
    id: StepOptionsOrId,
    payload: InngestEventPayload | ReadonlyArray<InngestEventPayload>,
  ) => Effect.Effect<{ readonly ids: ReadonlyArray<string> }, SendEventError>;
}

interface RunContext {
  readonly id: string;
  readonly attempt: number;
  readonly maxAttempts: number;
}

export interface HandlerContext<F extends InngestFunction.Any> {
  readonly event: InngestFunction.EventType<F>;
  readonly step: StepTools;
  readonly run: RunContext;
}

export const createStepTools = (
  request: Protocol.SDKRequestBody,
  appName: string,
  identity: StepIdentity["Service"],
  checkpoint: Option.Option<CheckpointState> = Option.none(),
): StepTools => {
  const input = fromSdkRequestBody(request);
  const runtime = Layer.mergeAll(
    Layer.succeed(StepIdentity, identity),
    Layer.succeed(CurrentCheckpoint, checkpoint),
    Layer.effect(
      HandlerFiberScope,
      Effect.map(
        Effect.serviceOption(HandlerFiberScope),
        Option.getOrElse(() => ({ isForkedFromHandlerRoot: Effect.succeed(false) })),
      ),
    ),
    StepCommandSink.layer,
    EventApi.layer,
  );

  const sleep = (opts: StepOptionsOrId, duration: Duration.Input) =>
    SleepStep.sleep({ input, id: opts, duration }).pipe(Effect.provide(runtime));

  const sleepUntil = (opts: StepOptionsOrId, timestamp: Date | number | string) =>
    SleepUntilStep.sleepUntil({ input, id: opts, timestamp }).pipe(Effect.provide(runtime));

  const waitForEvent = <E extends EventSchema>(opts: StepOptionsOrId, event: E, options: WaitForEventOptions) =>
    WaitForEventStep.waitForEvent({ input, id: opts, event, options }).pipe(Effect.provide(runtime));

  const invoke = <F extends InngestFunction.Any>(opts: StepOptionsOrId, options: InvokeOptions<F>) =>
    InvokeStep.invoke({ input, appName, id: opts, options }).pipe(Effect.provide(runtime));

  const run = <A, Err, R>(
    opts: StepOptionsOrId,
    effect: Effect.Effect<A, Err, R>,
    options?: StepRunOptions<JsonSchema<A>>,
  ) => StepRun.run({ input, id: opts, effect, options }).pipe(Effect.provide(runtime));

  const sendEvent = (opts: StepOptionsOrId, payload: InngestEventPayload | ReadonlyArray<InngestEventPayload>) =>
    SendEventStep.sendEvent({ input, id: opts, payload }).pipe(Effect.provide(runtime));

  return {
    run: run as StepTools["run"],
    sleep: sleep as StepTools["sleep"],
    sleepUntil: sleepUntil as StepTools["sleepUntil"],
    waitForEvent: waitForEvent as StepTools["waitForEvent"],
    invoke: invoke as StepTools["invoke"],
    sendEvent: sendEvent as StepTools["sendEvent"],
  };
};

export const buildHandlerContext = <F extends InngestFunction.Any>(
  fn: F,
  step: StepTools,
  request: Protocol.SDKRequestBody,
): Effect.Effect<HandlerContext<F>> =>
  Effect.gen(function* () {
    const event = yield* EventPayload.decodeInvocation({ fn, input: fromSdkRequestBody(request) }).pipe(Effect.orDie);

    return {
      event,
      step,
      run: {
        id: request.ctx.run_id,
        attempt: request.ctx.attempt,
        maxAttempts: request.ctx.max_attempts,
      },
    };
  });
