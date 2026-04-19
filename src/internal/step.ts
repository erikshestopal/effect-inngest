/**
 * Internal step tools implementation.
 * @internal
 */
import * as Arr from "effect/Array";
import * as Context from "effect/Context";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as HashMap from "effect/HashMap";
import * as Match from "effect/Match";
import * as Option from "effect/Option";
import * as Predicate from "effect/Predicate";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";
import { pipe } from "effect/Function";
import { InngestClient } from "../Client.js";
import type { InngestFunction } from "../Function.js";
import * as Protocol from "./protocol.js";
import { StepError, SendEventError, isNonRetriableError, isRetryAfterError } from "./errors.js";
import { timeStr, formatTimestamp } from "./helpers.js";
import { OtelAttributes } from "./constants.js";
import { decodeMemo, type Memo } from "./memo.js";

import {
  StepInterrupt,
  type StepInfo,
  sleepInterrupt,
  waitForEventInterrupt,
  invokeInterrupt,
  plannedInterrupt,
  runInterrupt,
  errorInterrupt,
} from "./interrupts.js";

export { StepInterrupt, type StepInfo } from "./interrupts.js";

/** @internal */
const hashStepId = (id: string, repeatIndex: number = 0): Effect.Effect<string> => {
  const effectiveId = repeatIndex > 0 ? `${id}:${repeatIndex}` : id;
  return Effect.map(
    Effect.promise(() => globalThis.crypto.subtle.digest("SHA-1", new TextEncoder().encode(effectiveId))),
    (buffer) => new Uint8Array(buffer).toHex(),
  );
};

const errorOtelAttributes = (err: unknown): Record<string, string> => {
  const attrs: Record<string, string> = {};
  if (err instanceof Error) {
    attrs[OtelAttributes.ExceptionType] = err.name;
    attrs[OtelAttributes.ExceptionMessage] = err.message;
    if (err.stack) attrs[OtelAttributes.ExceptionStacktrace] = err.stack;
  } else if (Predicate.hasProperty(err, "_tag") && typeof err._tag === "string") {
    attrs[OtelAttributes.ExceptionType] = err._tag;
    if (Predicate.hasProperty(err, "message") && typeof err.message === "string") {
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

interface InvokeOptionsBase<F extends InngestFunction.Any> {
  readonly function: F;
  readonly user?: Record<string, unknown>;
  readonly v?: string;
  readonly timeout?: Duration.Input;
}

type InvokeOptions<F extends InngestFunction.Any> = [InngestFunction.EventType<F>] extends [never]
  ? InvokeOptionsBase<F>
  : InvokeOptionsBase<F> & { readonly data: InngestFunction.EventType<F> };

type EventSchema = Schema.Top & { readonly identifier: string };
type TaggedEvent = { readonly _tag: string };

const encodeTaggedEvent = (event: TaggedEvent): Effect.Effect<unknown, never, never> => {
  const ctor = event.constructor;
  if (Schema.isSchema(ctor)) {
    return Schema.encodeEffect(ctor as unknown as Schema.Top)(event).pipe(
      Effect.orElseSucceed(() => event),
    ) as Effect.Effect<unknown, never, never>;
  }
  return Effect.succeed(event);
};

interface StepTools {
  readonly run: <A, Err, R>(
    id: StepOptionsOrId,
    effect: Effect.Effect<A, Err, R>,
  ) => Effect.Effect<A, StepError | Err, R>;
  readonly sleep: (id: StepOptionsOrId, duration: Duration.Input) => Effect.Effect<void>;
  readonly sleepUntil: (id: StepOptionsOrId, timestamp: Date | number | string) => Effect.Effect<void>;
  readonly waitForEvent: <E extends EventSchema>(
    id: StepOptionsOrId,
    event: E,
    options: WaitForEventOptions,
  ) => Effect.Effect<Option.Option<Schema.Schema.Type<E>>>;
  readonly invoke: <F extends InngestFunction.Any>(
    id: StepOptionsOrId,
    options: InvokeOptions<F>,
  ) => Effect.Effect<InngestFunction.Success<F>, StepError>;
  readonly sendEvent: (
    id: StepOptionsOrId,
    payload: TaggedEvent | ReadonlyArray<TaggedEvent>,
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

export class Step extends Context.Service<Step, StepTools>()("effect-inngest/Step") {}

const normalizeOpts = (opts: StepOptionsOrId): { id: string; name: string } =>
  typeof opts === "string" ? { id: opts, name: opts } : { id: opts.id, name: opts.name ?? opts.id };

const stepError = (stepId: string, message: string, opts?: { noRetry?: boolean; cause?: unknown }) =>
  Effect.fail(StepError.make({ stepId, message, noRetry: opts?.noRetry, cause: opts?.cause }));

export const createStepTools = (
  request: Protocol.SDKRequestBody,
  appName: string,
  stepIdCounts: Ref.Ref<HashMap.HashMap<string, number>>,
): StepTools => {
  const ctx = request.ctx;
  const steps = request.steps as Record<string, unknown>;

  const getInfo = (opts: StepOptionsOrId): Effect.Effect<StepInfo> => {
    const { id, name } = normalizeOpts(opts);
    return Effect.flatMap(
      Ref.modify(stepIdCounts, (map) => {
        const count = Option.getOrElse(HashMap.get(map, id), () => 0);
        return [count, HashMap.set(map, id, count + 1)];
      }),
      (count) => Effect.map(hashStepId(id, count), (hash) => ({ id, name, hash })),
    );
  };

  const getMemo = (hash: string): Memo => decodeMemo(steps[hash]);
  const canExecute = (hash: string) => ctx.step_id === hash || ctx.step_id === "step";
  const isBlocked = (hash: string) => ctx.disable_immediate_execution && ctx.step_id !== hash;

  const sleep = (opts: StepOptionsOrId, duration: Duration.Input): Effect.Effect<void, StepInterrupt> =>
    Effect.flatMap(getInfo(opts), (info) =>
      pipe(
        getMemo(info.hash),
        Match.value,
        Match.tag("MemoData", () => Effect.void),
        Match.tag("MemoTimeout", () => Effect.void),
        Match.tag("MemoError", () => Effect.void),
        Match.tag("MemoInput", () => Effect.void),
        Match.tag("MemoNone", () => Effect.fail(sleepInterrupt({ info, duration: timeStr(duration) }))),
        Match.exhaustive,
      ),
    );

  const sleepUntil = (opts: StepOptionsOrId, timestamp: Date | number | string): Effect.Effect<void, StepInterrupt> =>
    Effect.flatMap(getInfo(opts), (info) =>
      pipe(
        getMemo(info.hash),
        Match.value,
        Match.tag("MemoData", () => Effect.void),
        Match.tag("MemoTimeout", () => Effect.void),
        Match.tag("MemoError", () => Effect.void),
        Match.tag("MemoInput", () => Effect.void),
        Match.tag("MemoNone", () => Effect.fail(sleepInterrupt({ info, duration: formatTimestamp(timestamp) }))),
        Match.exhaustive,
      ),
    );

  const waitForEvent = <E extends EventSchema>(
    opts: StepOptionsOrId,
    event: E,
    options: WaitForEventOptions,
  ): Effect.Effect<Option.Option<Schema.Schema.Type<E>>, StepInterrupt> =>
    Effect.flatMap(getInfo(opts), (info) =>
      pipe(
        getMemo(info.hash),
        Match.value,
        Match.tag("MemoData", ({ data }) => {
          // null/undefined = timeout (no matching event received)
          if (data == null) return Effect.succeed(Option.none());
          // Inngest returns full event { name, data, id, ts } - extract .data for payload
          // Or may return payload directly - use .data if present, otherwise use data as-is
          const event = data as { data?: unknown };
          const payload = event.data !== undefined ? event.data : data;
          if (payload == null) return Effect.succeed(Option.none());
          return Effect.succeed(Option.some(payload as Schema.Schema.Type<E>));
        }),
        Match.tag("MemoTimeout", () => Effect.succeed(Option.none())),
        Match.tag("MemoError", () => Effect.succeed(Option.none())),
        Match.tag("MemoInput", () => Effect.succeed(Option.none())),
        Match.tag("MemoNone", () =>
          Effect.fail(
            waitForEventInterrupt({ info, event: event.identifier, timeout: timeStr(options.timeout), if: options.if }),
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
        getMemo(info.hash),
        Match.value,
        Match.tag("MemoData", ({ data }) => Effect.succeed(data as InngestFunction.Success<F>)),
        Match.tag("MemoError", ({ error }) =>
          stepError(info.id, Predicate.hasProperty(error, "message") ? String(error.message) : "Invoke failed", {
            cause: error,
          }),
        ),
        Match.tag("MemoTimeout", () => stepError(info.id, "Invoke timed out", { noRetry: true })),
        Match.tag("MemoInput", () => Effect.succeed(undefined as InngestFunction.Success<F>)),
        Match.tag("MemoNone", () => {
          const rawData = Predicate.hasProperty(options, "data") ? (options.data as TaggedEvent) : undefined;
          const encodeData = rawData ? encodeTaggedEvent(rawData) : Effect.succeed(undefined);
          return Effect.flatMap(encodeData, (encodedData) =>
            Effect.fail(
              invokeInterrupt({
                info,
                functionId: `${appName}-${options.function._tag}`,
                payload: {
                  data: encodedData,
                  user: options.user ?? {},
                  v: options.v ?? "1",
                },
                timeout: options.timeout ? timeStr(options.timeout) : "365d",
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
  ): Effect.Effect<A, StepInterrupt | StepError | Err, R> =>
    Effect.flatMap(getInfo(opts), (info) =>
      pipe(
        getMemo(info.hash),
        Match.value,
        Match.tag("MemoData", ({ data }) => Effect.succeed(data as A)),
        Match.tag("MemoError", ({ error }) =>
          stepError(info.id, Predicate.hasProperty(error, "message") ? String(error.message) : "Step failed", {
            noRetry: true,
          }),
        ),
        Match.tag("MemoTimeout", () => stepError(info.id, "Step timed out", { noRetry: true })),
        Match.tag("MemoInput", () => stepError(info.id, "Unexpected step result type: input")),
        Match.tag("MemoNone", () => {
          if (isBlocked(info.hash) || !canExecute(info.hash)) {
            return Effect.fail(plannedInterrupt({ info }));
          }

          return effect.pipe(
            Effect.withSpan(`inngest.step/run/${info.id}`, {
              attributes: { [OtelAttributes.StepId]: info.id, [OtelAttributes.StepType]: "run" },
            }),
            Effect.matchEffect({
              onFailure: (err) => {
                const noRetry = isNonRetriableError(err) ? true : undefined;
                const retryAfterMs = isRetryAfterError(err) ? Duration.toMillis(err.retryAfter) : undefined;
                return Effect.andThen(
                  Effect.annotateCurrentSpan(errorOtelAttributes(err)),
                  Effect.fail(errorInterrupt({ info, error: err, noRetry, retryAfterMs })),
                );
              },
              onSuccess: (data) => Effect.fail(runInterrupt({ info, data })),
            }),
            Effect.catchDefect((defect) =>
              Effect.andThen(
                Effect.annotateCurrentSpan(errorOtelAttributes(defect)),
                Effect.fail(errorInterrupt({ info, error: defect })),
              ),
            ),
          );
        }),
        Match.exhaustive,
      ),
    );

  const sendEvent = (
    opts: StepOptionsOrId,
    payload: TaggedEvent | ReadonlyArray<TaggedEvent>,
  ): Effect.Effect<{ readonly ids: ReadonlyArray<string> }, StepInterrupt | SendEventError, InngestClient> =>
    Effect.flatMap(getInfo(opts), (info) =>
      pipe(
        getMemo(info.hash),
        Match.value,
        Match.tag("MemoData", ({ data }) => Effect.succeed(data as { readonly ids: ReadonlyArray<string> })),
        Match.tag("MemoError", () => Effect.fail(SendEventError.make({ message: "SendEvent failed", events: [] }))),
        Match.tag("MemoTimeout", () =>
          Effect.fail(SendEventError.make({ message: "SendEvent timed out", events: [] })),
        ),
        Match.tag("MemoInput", () => Effect.succeed({ ids: [] as ReadonlyArray<string> })),
        Match.tag("MemoNone", () => {
          if (isBlocked(info.hash) || !canExecute(info.hash)) {
            return Effect.fail(plannedInterrupt({ info }));
          }

          const events = Arr.ensure(payload);
          return Effect.flatMap(
            Effect.forEach(events, (e) =>
              Effect.map(encodeTaggedEvent(e), (encoded) => ({ name: e._tag, data: encoded })),
            ),
            (eventPayloads) =>
              InngestClient.use((client) =>
                client.sendEvent(eventPayloads).pipe(
                  Effect.withSpan(`inngest.step/sendEvent/${info.id}`, {
                    attributes: { [OtelAttributes.StepId]: info.id, [OtelAttributes.StepType]: "sendEvent" },
                  }),
                  Effect.flatMap((result) => Effect.fail(runInterrupt({ info, data: result }))),
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
): HandlerContext<F> => {
  // Batch mode: function has batchEvents configured - always return array of event data payloads
  const isBatchMode = fn.options?.batchEvents != null;
  if (isBatchMode) {
    const eventDataArray = request.events.map((e) => e.data);
    return {
      event: eventDataArray as InngestFunction.EventType<F>,
      step,
      run: {
        id: request.ctx.run_id,
        attempt: request.ctx.attempt,
        maxAttempts: request.ctx.max_attempts,
      },
    };
  }

  // When invoked via step.invoke, Inngest sends "inngest/function.invoked" event
  // The payload is in event.data but mixed with _inngest metadata - extract just the user data
  let eventData = request.event.data;
  if (request.event.name === "inngest/function.invoked" && typeof eventData === "object" && eventData !== null) {
    // Remove _inngest metadata, keep only the invoke payload
    const { _inngest, ...payload } = eventData as Record<string, unknown>;
    eventData = payload;
  }

  return {
    event: eventData as InngestFunction.EventType<F>,
    step,
    run: {
      id: request.ctx.run_id,
      attempt: request.ctx.attempt,
      maxAttempts: request.ctx.max_attempts,
    },
  };
};
