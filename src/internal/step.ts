/**
 * Internal step tools implementation.
 * @internal
 */
import { Array as Arr, Duration, Effect, Match, Option, Predicate, Schema, pipe } from "effect";
import { InngestClient } from "../Client.js";
import type { InngestFunction } from "../Function.js";
import type { CheckpointState } from "./checkpoint.js";
import * as Protocol from "./protocol.js";
import { StepError, SendEventError, isNonRetriableError, isRetryAfterError } from "./errors.js";
import { OtelAttributes } from "./constants.js";
import { InngestDuration } from "../next/internal/wire/Duration.js";
import { InngestTimestamp } from "../next/internal/wire/Timestamp.js";
import { CurrentCheckpoint } from "../next/internal/runtime/CheckpointContext.js";
import { HandlerFiberScope } from "../next/internal/runtime/HandlerFiberScope.js";
import { StepCommandSink } from "../next/internal/runtime/StepCommandSink.js";
import { StepIdentity } from "../next/internal/runtime/StepIdentity.js";
import { fromSdkRequestBody } from "../next/internal/domain/ExecutionInput.js";
import * as SleepStep from "../next/internal/runtime/steps/SleepStep.js";
import * as Memo from "../next/internal/domain/Memo.js";
import * as EventPayload from "../next/internal/codec/EventPayload.js";
import { eventSchemaFor, eventSchemas } from "../next/internal/domain/FunctionDefinition.js";
import type * as InngestEvent from "../Event.js";

import {
  StepInterrupt,
  type StepInfo,
  sleepInterrupt,
  waitForEventInterrupt,
  invokeInterrupt,
  plannedInterrupt,
  runInterrupt,
  errorInterrupt,
  failedInterrupt,
} from "./interrupts.js";

export { StepInterrupt, type StepInfo } from "./interrupts.js";

const isStepInterrupt: (u: unknown) => u is StepInterrupt = Predicate.isTagged("StepInterrupt") as (
  u: unknown,
) => u is StepInterrupt;

const errorOtelAttributes = (err: unknown): Record<string, string> => {
  const attrs: Record<string, string> = {};
  if (err instanceof Error) {
    attrs[OtelAttributes.ExceptionType] = err.name;
    attrs[OtelAttributes.ExceptionMessage] = err.message;
    if (err.stack) {
      attrs[OtelAttributes.ExceptionStacktrace] = err.stack;
    }
  } else if (Predicate.hasProperty(err, "_tag") && Predicate.isString(err._tag)) {
    attrs[OtelAttributes.ExceptionType] = err._tag;
    if (Predicate.hasProperty(err, "message") && Predicate.isString(err.message)) {
      attrs[OtelAttributes.ExceptionMessage] = err.message;
    }
  } else {
    attrs[OtelAttributes.ExceptionMessage] = String(err);
  }
  return attrs;
};

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

type InvokeOptions<F extends InngestFunction.Any> = [InngestFunction.EventType<F>] extends [never]
  ? InvokeOptionsBase<F>
  : InvokeOptionsBase<F> & { readonly data: InngestFunction.EventType<F> };

type EventSchema = InngestEvent.EventDefinition;
type InngestEventPayload = InngestEvent.EventType<InngestEvent.EventDefinition>;

const stepDecodeError = (stepId: string, cause: unknown): StepError =>
  StepError.make({
    stepId,
    message: Predicate.hasProperty(cause, "message") ? String(cause.message) : String(cause),
    noRetry: true,
    cause,
  });

const decodeJson = <A>(schema: JsonSchema<A>, value: unknown, stepId: string): Effect.Effect<A, StepError> =>
  Schema.decodeUnknownEffect(Schema.toCodecJson(schema))(value).pipe(
    Effect.mapError((cause) => stepDecodeError(stepId, cause)),
  );

const encodeJson = <A>(schema: JsonSchema<A>, value: A, stepId: string): Effect.Effect<unknown, StepError> =>
  Schema.encodeEffect(Schema.toCodecJson(schema))(value).pipe(
    Effect.mapError((cause) => stepDecodeError(stepId, cause)),
  );

const encodeUnknownJson = (value: unknown, stepId: string): Effect.Effect<Schema.Json, StepError> =>
  Predicate.isUndefined(value)
    ? Effect.succeed(null)
    : Schema.encodeEffect(Schema.UnknownFromJsonString)(value).pipe(
        Effect.flatMap(Schema.decodeEffect(Schema.UnknownFromJsonString)),
        Effect.flatMap(Schema.decodeUnknownEffect(Schema.Json)),
        Effect.mapError((cause) => stepDecodeError(stepId, cause)),
      );

const decodeEventData = <F extends InngestFunction.Any>(args: {
  readonly fn: F;
  readonly eventName: string;
  readonly eventData: unknown;
}): Effect.Effect<InngestFunction.EventType<F>, EventPayload.EventDecodeError> =>
  Option.match(eventSchemaFor({ fn: args.fn, eventName: args.eventName }), {
    onNone: () => Effect.succeed(args.eventData as InngestFunction.EventType<F>),
    onSome: (event) =>
      EventPayload.decodeSchema({
        event,
        eventName: args.eventName,
        eventData: args.eventData,
      }).pipe(Effect.map((decoded) => decoded as InngestFunction.EventType<F>)),
  });

const decodeInvocation = <F extends InngestFunction.Any>(args: {
  readonly fn: F;
  readonly request: Protocol.SDKRequestBody;
}): Effect.Effect<InngestFunction.EventType<F>, EventPayload.EventDecodeError> => {
  if (Predicate.isNotNullish(args.fn.options?.batchEvents)) {
    return Effect.forEach(args.request.events, (event) =>
      decodeEventData({ fn: args.fn, eventName: event.name, eventData: event.data }),
    ).pipe(Effect.map((events) => events as unknown as InngestFunction.EventType<F>));
  }

  if (EventPayload.isFunctionInvoked(args.request.event)) {
    const { _inngest, ...payload } = args.request.event.data;
    return Option.match(Arr.head(eventSchemas(args.fn)), {
      onNone: () => Effect.succeed(payload as unknown as InngestFunction.EventType<F>),
      onSome: (event) =>
        EventPayload.decodeSchema({ event, eventName: event.identifier, eventData: payload }).pipe(
          Effect.map((decoded) => decoded as InngestFunction.EventType<F>),
        ),
    });
  }

  return decodeEventData({
    fn: args.fn,
    eventName: args.request.event.name,
    eventData: args.request.event.data,
  });
};

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

const stepError = (stepId: string, message: string, opts?: { noRetry?: boolean; cause?: unknown }) =>
  Effect.fail(StepError.make({ stepId, message, noRetry: opts?.noRetry, cause: opts?.cause }));

const handlerFiberScope = Effect.map(
  Effect.serviceOption(HandlerFiberScope),
  Option.getOrElse(() => ({ isForkedFromHandlerRoot: Effect.succeed(false) })),
);

export const createStepTools = (
  request: Protocol.SDKRequestBody,
  appName: string,
  identity: StepIdentity["Service"],
  checkpoint: Option.Option<CheckpointState> = Option.none(),
): StepTools => {
  const ctx = request.ctx;
  const input = fromSdkRequestBody(request);

  const getInfo = (opts: StepOptionsOrId): Effect.Effect<StepInfo> => identity.resolve(opts);
  const memo = (info: StepInfo): Memo.Memo => Memo.decode(request.steps[info.hash]);
  const canExecute = (hash: string) => ctx.step_id === hash || ctx.step_id === "step";
  const isBlocked = (hash: string) => ctx.disable_immediate_execution && ctx.step_id !== hash;

  // In checkpoint mode, async opcodes (sleep/wait/invoke) MUST flush the
  // buffer before yielding so the executor sees buffered StepRuns prepended
  // to the async opcode in the 206 response (spec §10.2 / §10.4.1 #6).
  const flushIfCheckpoint = Option.match(checkpoint, {
    onNone: () => Effect.void,
    onSome: (state) => state.flush,
  });

  const planIfCheckpoint = (op: typeof Protocol.GeneratorOpcode.Type, order?: number): Effect.Effect<void> =>
    Option.match(checkpoint, {
      onNone: () => Effect.void,
      onSome: (state) => state.planOpcode(op, order),
    });

  const isParallelRootChild =
    Option.isSome(checkpoint) && ctx.step_id === "step"
      ? Effect.flatMap(handlerFiberScope, (scope) => scope.isForkedFromHandlerRoot)
      : Effect.succeed(false);

  const yieldPlannedIfRuntimeExceeded = (info: StepInfo): Effect.Effect<void, never> =>
    Option.match(checkpoint, {
      onNone: () => Effect.void,
      onSome: (state) =>
        ctx.step_id === "step"
          ? Effect.gen(function* () {
              if (yield* state.isRuntimeExceeded) {
                yield* state.flush;
                return yield* Effect.die(plannedInterrupt({ info }));
              }
            })
          : Effect.void,
    });

  const sleep = (opts: StepOptionsOrId, duration: Duration.Input): Effect.Effect<void, StepInterrupt> =>
    SleepStep.sleep({ input, id: opts, duration }).pipe(
      Effect.provideService(StepIdentity, identity),
      Effect.provideService(CurrentCheckpoint, checkpoint),
      Effect.provideServiceEffect(HandlerFiberScope, handlerFiberScope),
      Effect.provide(StepCommandSink.layer),
    );

  const sleepUntil = (opts: StepOptionsOrId, timestamp: Date | number | string): Effect.Effect<void, StepInterrupt> =>
    Effect.flatMap(getInfo(opts), (info) =>
      pipe(
        memo(info),
        Match.value,
        Match.tag("MemoData", "MemoTimeout", "MemoError", "MemoInput", () => Effect.void),
        Match.tag("MemoNone", () =>
          Effect.andThen(
            flushIfCheckpoint,
            Effect.die(sleepInterrupt({ info, duration: Schema.decodeUnknownSync(InngestTimestamp)(timestamp) })),
          ).pipe(
            Effect.withSpan(`inngest.step/sleepUntil/${info.id}`, {
              attributes: { [OtelAttributes.StepId]: info.id, [OtelAttributes.StepType]: "sleepUntil" },
            }),
          ),
        ),
        Match.exhaustive,
      ),
    );

  const waitForEvent = <E extends EventSchema>(
    opts: StepOptionsOrId,
    event: E,
    options: WaitForEventOptions,
  ): Effect.Effect<Option.Option<InngestEvent.EventType<E>>, StepInterrupt | StepError> =>
    Effect.flatMap(getInfo(opts), (info) =>
      pipe(
        memo(info),
        Match.value,
        Match.tag("MemoData", ({ data }) => {
          // null/undefined = timeout (no matching event received)
          if (Predicate.isNullish(data)) {
            return Effect.succeed(Option.none());
          }
          return EventPayload.decodeSchema({
            event,
            eventName: event.identifier,
            eventData: Predicate.isObject(data) && Predicate.hasProperty(data, "data") ? data.data : data,
          }).pipe(
            Effect.map(Option.some),
            Effect.mapError((cause) => stepDecodeError(info.id, cause)),
          );
        }),
        Match.tag("MemoTimeout", "MemoError", "MemoInput", () => Effect.succeed(Option.none())),
        Match.tag("MemoNone", () =>
          Effect.andThen(
            flushIfCheckpoint,
            Effect.die(
              waitForEventInterrupt({
                info,
                event: event.identifier,
                timeout: Schema.encodeSync(InngestDuration)(Duration.fromInputUnsafe(options.timeout)),
                if: options.if,
              }),
            ),
          ),
        ),
        Match.exhaustive,
      ),
    );

  const invoke = <F extends InngestFunction.Any>(
    opts: StepOptionsOrId,
    options: InvokeOptions<F>,
  ): Effect.Effect<InngestFunction.Success<F>, StepInterrupt | StepError> =>
    Effect.flatMap(getInfo(opts), (info) =>
      pipe(
        memo(info),
        Match.value,
        Match.tag("MemoData", ({ data }) =>
          decodeJson(options.function.success as JsonSchema<InngestFunction.Success<F>>, data, info.id),
        ),
        Match.tag("MemoError", ({ error }) =>
          stepError(info.id, Predicate.hasProperty(error, "message") ? String(error.message) : "Invoke failed", {
            cause: error,
          }),
        ),
        Match.tag("MemoTimeout", () => stepError(info.id, "Invoke timed out", { noRetry: true })),
        Match.tag("MemoInput", () => Effect.succeed(undefined as InngestFunction.Success<F>)),
        Match.tag("MemoNone", () => {
          const event = Predicate.hasProperty(options, "data") ? (options.data as InngestEventPayload) : undefined;
          return Effect.andThen(
            flushIfCheckpoint,
            Effect.die(
              invokeInterrupt({
                info,
                functionId: `${appName}-${options.function._tag}`,
                payload: {
                  data: event?.data,
                  ...(Predicate.isNotUndefined(options.user) ? { user: options.user } : {}),
                  ...(Predicate.isNotUndefined(options.v) ? { v: options.v } : {}),
                },
                timeout: options.timeout
                  ? Schema.encodeSync(InngestDuration)(Duration.fromInputUnsafe(options.timeout))
                  : undefined,
              }),
            ),
          );
        }),
        Match.exhaustive,
      ),
    );

  const run = <A, Err, R>(
    opts: StepOptionsOrId,
    effect: Effect.Effect<A, Err, R>,
    options?: StepRunOptions<JsonSchema<A>>,
  ): Effect.Effect<A | StepRunOutput<A>, StepInterrupt | StepError | Err, R> =>
    Effect.flatMap(getInfo(opts), (info) =>
      pipe(
        memo(info),
        Match.value,
        Match.tag("MemoData", ({ data }) =>
          options?.schema ? decodeJson(options.schema, data, info.id) : Effect.succeed(data as StepRunOutput<A>),
        ),
        Match.tag("MemoError", ({ error }) =>
          // Spec §5.2.2: an uncaught memoized step error MUST be treated as
          // non-retriable. If the user wanted to recover they would have
          // caught the StepError at the call site; reaching the driver's
          // top-level failure path means the error is propagating unhandled.
          stepError(info.id, Predicate.hasProperty(error, "message") ? String(error.message) : "Step failed", {
            noRetry: true,
            cause: error,
          }),
        ),
        Match.tag("MemoTimeout", () => stepError(info.id, "Step timed out", { noRetry: true })),
        Match.tag("MemoInput", () => stepError(info.id, "Unexpected step result type: input")),
        Match.tag("MemoNone", () => {
          if (isBlocked(info.hash) || !canExecute(info.hash)) {
            return Effect.die(plannedInterrupt({ info }));
          }

          return yieldPlannedIfRuntimeExceeded(info)
            .pipe(
              Effect.flatMap(() =>
                Effect.gen(function* () {
                  if (yield* isParallelRootChild) {
                    yield* planIfCheckpoint(Protocol.stepPlanned(info), info.order);
                    return true;
                  }
                  return false;
                }),
              ),
              Effect.flatMap((planned) =>
                planned
                  ? Effect.succeed(undefined as unknown as StepRunOutput<A>)
                  : effect.pipe(
                      Effect.withSpan(`inngest.step/run/${info.id}`, {
                        attributes: { [OtelAttributes.StepId]: info.id, [OtelAttributes.StepType]: "run" },
                      }),
                      Effect.matchEffect({
                        onFailure: (err) => {
                          const noRetry = isNonRetriableError(err) ? true : undefined;
                          const retryAfterMs = isRetryAfterError(err) ? Duration.toMillis(err.retryAfter) : undefined;
                          const interrupt =
                            noRetry === true || ctx.attempt >= ctx.max_attempts - 1
                              ? failedInterrupt({ info, error: err })
                              : errorInterrupt({ info, error: err, noRetry, retryAfterMs });
                          return Effect.andThen(
                            Effect.annotateCurrentSpan(errorOtelAttributes(err)),
                            Effect.die(interrupt),
                          );
                        },
                        onSuccess: (data) => {
                          const encoded = Predicate.isUndefined(data)
                            ? Effect.succeed(undefined)
                            : options?.schema
                              ? encodeJson(options.schema, data, info.id)
                              : encodeUnknownJson(data, info.id);

                          return Effect.flatMap(encoded, (encodedData) =>
                            Option.match(checkpoint, {
                              // Async (non-checkpoint) mode: surface result via interrupt — driver
                              // returns 206 with a single StepRun and yields back to executor.
                              onNone: () => Effect.die(runInterrupt({ info, data: encodedData })),
                              // Checkpoint mode: buffer the StepRun (best-effort flush handled by
                              // bufferStep) and continue execution with the value (spec §10.4.1).
                              onSome: (state) =>
                                Effect.as(
                                  state.bufferStep(Protocol.stepRun(info, encodedData)),
                                  options?.schema ? data : (encodedData as StepRunOutput<A>),
                                ),
                            }),
                          );
                        },
                      }),
                    ),
              ),
            )
            .pipe(
              Effect.catchDefect((defect) =>
                Effect.andThen(
                  Effect.annotateCurrentSpan(errorOtelAttributes(defect)),
                  isStepInterrupt(defect) ? Effect.die(defect) : Effect.die(errorInterrupt({ info, error: defect })),
                ),
              ),
            );
        }),
        Match.exhaustive,
      ),
    );

  const sendEvent = (
    opts: StepOptionsOrId,
    payload: InngestEventPayload | ReadonlyArray<InngestEventPayload>,
  ): Effect.Effect<{ readonly ids: ReadonlyArray<string> }, StepInterrupt | SendEventError, InngestClient> =>
    Effect.flatMap(getInfo(opts), (info) =>
      pipe(
        memo(info),
        Match.value,
        Match.tag("MemoData", ({ data }) => Effect.succeed(data as { readonly ids: ReadonlyArray<string> })),
        Match.tag("MemoError", () => Effect.fail(SendEventError.make({ message: "SendEvent failed", events: [] }))),
        Match.tag("MemoTimeout", () =>
          Effect.fail(SendEventError.make({ message: "SendEvent timed out", events: [] })),
        ),
        Match.tag("MemoInput", () => Effect.succeed({ ids: [] as ReadonlyArray<string> })),
        Match.tag("MemoNone", () => {
          if (isBlocked(info.hash) || !canExecute(info.hash)) {
            return Effect.die(plannedInterrupt({ info }));
          }

          const plannedInfo = info;
          const events = Arr.ensure(payload);
          return yieldPlannedIfRuntimeExceeded(plannedInfo).pipe(
            Effect.flatMap(() =>
              Effect.gen(function* () {
                if (yield* isParallelRootChild) {
                  yield* planIfCheckpoint(Protocol.sendEventStepPlanned(plannedInfo), info.order);
                  return true;
                }
                return false;
              }),
            ),
            Effect.flatMap((planned) =>
              planned
                ? Effect.succeed({ ids: [] as ReadonlyArray<string> })
                : InngestClient.use((client) =>
                    client.sendEvent(events).pipe(
                      Effect.withSpan(`inngest.step/sendEvent/${info.id}`, {
                        attributes: { [OtelAttributes.StepId]: info.id, [OtelAttributes.StepType]: "sendEvent" },
                      }),
                      Effect.flatMap((result) =>
                        Option.match(checkpoint, {
                          onNone: () =>
                            Effect.die(
                              StepInterrupt.make({
                                opcode: Protocol.sendEventStepRunResponse(plannedInfo, { ids: result.ids }),
                              }),
                            ),
                          onSome: (state) =>
                            Effect.as(
                              state.bufferStep(
                                Protocol.sendEventStepRun(
                                  plannedInfo,
                                  { ids: result.ids },
                                  Arr.isArray(payload) ? events : events[0],
                                ),
                              ),
                              result,
                            ),
                        }),
                      ),
                    ),
                  ),
            ),
          );
        }),
        Match.exhaustive,
      ),
    );

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
    const event = yield* decodeInvocation({ fn, request }).pipe(Effect.orDie);

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
