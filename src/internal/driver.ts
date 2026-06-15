/**
 * Driver execution logic.
 * @internal
 */
import * as Headers from "effect/unstable/http/Headers";
import * as HttpTraceContext from "effect/unstable/http/HttpTraceContext";
import * as Cause from "effect/Cause";
import * as Chunk from "effect/Chunk";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as HashMap from "effect/HashMap";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import { pipe } from "effect/Function";
import * as Predicate from "effect/Predicate";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";
import type { InngestFunction } from "../Function.js";
import { InngestClient } from "../Client.js";
import * as Checkpoint from "./checkpoint.js";
import type { CheckpointConfig, CheckpointState } from "./checkpoint.js";
import { isRetryAfterError, isNonRetriableError, isStepError, type RetryAfterError, type StepError } from "./errors.js";
import * as Protocol from "./protocol.js";
import { StepInterrupt } from "./interrupts.js";
import { createStepTools, buildHandlerContext, type HandlerContext } from "./step.js";
import { OtelAttributes } from "./constants.js";

/** Trace context headers extracted from incoming request */
export interface TraceHeaders {
  readonly traceparent?: string;
  readonly tracestate?: string;
}

const SDK_VERSION = "2.0.0";

export class ExecutionResult extends Schema.Class<ExecutionResult>("ExecutionResult")({
  status: Schema.Literals([200, 206, 400, 500]),
  body: Schema.Unknown,
  headers: Schema.Record(Schema.String, Schema.String),
}) {}

const isStepInterrupt = Schema.is(StepInterrupt);

const collectStepInterruptsFromCause = <E>(cause: Cause.Cause<E>): Chunk.Chunk<StepInterrupt> => {
  const interrupts: Array<StepInterrupt> = [];
  for (const reason of cause.reasons) {
    if (Cause.isFailReason(reason) && isStepInterrupt(reason.error)) {
      interrupts.push(reason.error);
    } else if (Cause.isDieReason(reason) && isStepInterrupt(reason.defect)) {
      interrupts.push(reason.defect);
    }
  }
  return Chunk.fromIterable(interrupts);
};

const toUserError = (error: unknown): typeof Protocol.UserError.Type =>
  Protocol.UserError.make({
    name: Predicate.hasProperty(error, "name") ? String(error.name) : "Error",
    message: Predicate.hasProperty(error, "message") ? String(error.message) : String(error),
    stack: Predicate.hasProperty(error, "stack") ? String(error.stack) : undefined,
  });

const baseHeaders = (framework?: string): Record<string, string> => ({
  "Content-Type": "application/json",
  "User-Agent": `effect-inngest:v${SDK_VERSION}`,
  [Protocol.Headers.SDK]: `effect-inngest:v${SDK_VERSION}`,
  [Protocol.Headers.SDKHandled]: "true",
  [Protocol.Headers.RequestVersion]: "2",
  ...(framework ? { [Protocol.Headers.Framework]: framework } : {}),
});

const encodeOpcodes = (opcodes: ReadonlyArray<typeof Protocol.GeneratorOpcode.Type>): unknown =>
  Schema.encodeSync(Schema.Array(Protocol.GeneratorOpcode))(opcodes);

export const execute = <F extends InngestFunction.Any, R>(
  fn: F,
  handler: (ctx: HandlerContext<F>) => Effect.Effect<InngestFunction.Success<F>, unknown, R>,
  request: Protocol.SDKRequestBody,
  appName: string,
  traceHeaders: TraceHeaders = {},
  checkpointConfig: Option.Option<CheckpointConfig> = Option.none(),
): Effect.Effect<ExecutionResult, never, R | InngestClient> =>
  Effect.gen(function* () {
    const client = yield* InngestClient;
    const stepIdCounts = yield* Ref.make(HashMap.empty<string, number>());
    const headers = baseHeaders(client.config.framework);
    const requestStartedAt = yield* Clock.currentTimeMillis;

    // Build the optional CheckpointState. In checkpoint mode the step tools
    // buffer StepRun results into this state and yield (drain + DiscoveryRequest /
    // RunComplete / interrupt) once the handler resolves.
    const checkpointState: Option.Option<CheckpointState> = yield* Option.match(checkpointConfig, {
      onNone: () => Effect.succeed(Option.none<CheckpointState>()),
      onSome: (config) =>
        Effect.gen(function* () {
          const state = yield* Checkpoint.make({
            config,
            runId: request.ctx.run_id,
            fnId: request.ctx.fn_id,
            qiId: request.ctx.qi_id,
            checkpointAsync: (steps) =>
              client.checkpointAsync({
                runId: request.ctx.run_id,
                fnId: request.ctx.fn_id,
                qiId: request.ctx.qi_id,
                requestId: request.ctx.request_id,
                generationId: request.ctx.generation_id,
                requestStartedAt,
                steps,
              }),
          });
          return Option.some(state);
        }),
    });

    const runHandler: Effect.Effect<InngestFunction.Success<F>, unknown, R> = Effect.gen(function* () {
      const rootFiberId = yield* Effect.fiberId;
      const step = createStepTools(request, appName, stepIdCounts, rootFiberId, checkpointState);
      const context = yield* buildHandlerContext<F>(fn, step, request);
      return yield* handler(context);
    });

    /**
     * Drain any unflushed buffered opcodes (no-op outside checkpoint mode).
     * Used at every terminal branch so step results are never lost.
     */
    const drainBuffer: Effect.Effect<ReadonlyArray<typeof Protocol.GeneratorOpcode.Type>> = Option.match(
      checkpointState,
      {
        onNone: () => Effect.succeed([] as ReadonlyArray<typeof Protocol.GeneratorOpcode.Type>),
        onSome: (state) => state.drain,
      },
    );

    const drainPlanned: Effect.Effect<ReadonlyArray<typeof Protocol.GeneratorOpcode.Type>> = Option.match(
      checkpointState,
      {
        onNone: () => Effect.succeed([] as ReadonlyArray<typeof Protocol.GeneratorOpcode.Type>),
        onSome: (state) => state.drainPlanned,
      },
    );

    type DeadlineResult = Option.Option<InngestFunction.Success<F>>;
    const handlerWithDeadline: Effect.Effect<DeadlineResult, unknown, R> = Option.match(checkpointState, {
      onNone: () => Effect.map(runHandler, Option.some<InngestFunction.Success<F>>),
      onSome: (state) =>
        Effect.raceFirst(
          Effect.map(runHandler, Option.some<InngestFunction.Success<F>>),
          Effect.sleep(state.config.maxRuntime).pipe(
            Effect.flatMap(() => state.markRuntimeExceeded),
            Effect.flatMap(() => Effect.sleep(state.config.maxRuntime)),
            Effect.as(Option.none<InngestFunction.Success<F>>()),
          ),
        ),
    });

    const result = yield* Effect.scoped(handlerWithDeadline).pipe(
      Effect.flatMap((maybeValue) =>
        Effect.gen(function* () {
          const planned = yield* drainPlanned;
          if (planned.length > 0) {
            return ExecutionResult.make({ status: 206, body: encodeOpcodes(planned), headers });
          }

          const drained = yield* drainBuffer;
          // Checkpoint mode: assemble [drained..., RunComplete | DiscoveryRequest]
          // even when buffer is empty — TS reference always emits RunComplete on
          // completion so the executor can correlate (spec §10.4.1 #8).
          if (Option.isSome(checkpointState)) {
            const state = checkpointState.value;
            const exceeded = (yield* state.isRuntimeExceeded) || Option.isNone(maybeValue);
            const terminal = exceeded ? Protocol.discoveryRequest() : Protocol.runComplete(maybeValue.value);
            const opcodes = [...drained, terminal];
            return ExecutionResult.make({ status: 206, body: encodeOpcodes(opcodes), headers });
          }
          // Async mode: classic 200 with the bare return value.
          return ExecutionResult.make({
            status: 200,
            body: Option.getOrThrow(maybeValue),
            headers,
          });
        }),
      ),
      Effect.catchCause((cause) =>
        Effect.gen(function* () {
          const planned = yield* drainPlanned;
          if (planned.length > 0) {
            return ExecutionResult.make({ status: 206, body: encodeOpcodes(planned), headers });
          }

          // Drain buffer for inclusion in 206 / error response so step results
          // are never lost (spec §10.4.3 graceful fallback).
          const drained = yield* drainBuffer;

          // Collect all step interrupts from the cause (handles parallel failures)
          const interrupts = collectStepInterruptsFromCause(cause);

          if (!Chunk.isEmpty(interrupts)) {
            const interruptArray = Chunk.toReadonlyArray(interrupts);
            const targetedStepId = request.ctx.step_id === "step" ? undefined : request.ctx.step_id;
            const interruptOpcodes = interruptArray
              .map((interrupt) => interrupt.opcode)
              .filter((opcode) => !targetedStepId || opcode.id === targetedStepId);
            const opcodes = [...drained, ...interruptOpcodes];

            const hasNonRetriableError = opcodes.some(
              (op) =>
                op.op === Protocol.Opcode.StepFailed ||
                (op.op === Protocol.Opcode.StepError &&
                  Predicate.isObject(op.error) &&
                  Predicate.hasProperty(op.error, "noRetry") &&
                  op.error.noRetry === true),
            );

            const retryAfterMs = interruptArray.find((i) => Predicate.isNotUndefined(i.retryAfterMs))?.retryAfterMs;
            const hasRetriableStepError = opcodes.some((op) => op.op === Protocol.Opcode.StepError);
            const responseHeaders: Record<string, string> = hasNonRetriableError
              ? { ...headers, [Protocol.Headers.NoRetry]: "true" }
              : hasRetriableStepError
                ? { ...headers, [Protocol.Headers.NoRetry]: "false" }
                : headers;
            if (Predicate.isNotUndefined(retryAfterMs)) {
              responseHeaders[Protocol.Headers.RetryAfter] = String(Math.ceil(retryAfterMs / 1000));
              // Spec §4.4.3: "If `Retry-After` is set, an SDK MUST also set
              // `X-Inngest-No-Retry: false`." Overrides any prior value from
              // the non-retriable branch above — the presence of RetryAfter
              // implies the caller wants a retry at the specified delay.
              responseHeaders[Protocol.Headers.NoRetry] = "false";
            }
            return ExecutionResult.make({ status: 206, body: encodeOpcodes(opcodes), headers: responseHeaders });
          }

          // Extract the first error from cause for non-interrupt error handling.
          // `findErrorOption` only matches typed failures; fall back to the first
          // defect (Effect.die, unchecked throws) so we surface the original error.
          const errorOpt = Option.orElse(Cause.findErrorOption(cause), () => {
            const dieReason = cause.reasons.find(Cause.isDieReason);
            return dieReason ? Option.some(dieReason.defect) : Option.none();
          });
          if (Option.isNone(errorOpt)) {
            // No error in cause - shouldn't happen, but handle gracefully.
            // Buffered steps still surface in a 206 wrapping if any exist.
            if (drained.length > 0) {
              return ExecutionResult.make({
                status: 206,
                body: encodeOpcodes(drained),
                headers,
              });
            }
            return ExecutionResult.make({
              status: 500,
              body: { name: "Error", message: "Unknown error" },
              headers: { ...headers, [Protocol.Headers.NoRetry]: "false" },
            });
          }
          const error = errorOpt.value;

          // Check for RetryAfterError - use type guard and direct access
          if (isRetryAfterError(error)) {
            const retryAfterMs = Duration.toMillis((error as RetryAfterError).retryAfter);
            const retryAfterSeconds = Math.ceil(retryAfterMs / 1000);
            // Spec §10.4.3: include drained buffered steps in response when
            // present; otherwise existing 500 behavior.
            if (drained.length > 0) {
              return ExecutionResult.make({
                status: 206,
                body: encodeOpcodes(drained),
                headers: {
                  ...headers,
                  [Protocol.Headers.NoRetry]: "false",
                  [Protocol.Headers.RetryAfter]: String(retryAfterSeconds),
                },
              });
            }
            return ExecutionResult.make({
              status: 500,
              body: toUserError(error),
              headers: {
                ...headers,
                [Protocol.Headers.NoRetry]: "false",
                [Protocol.Headers.RetryAfter]: String(retryAfterSeconds),
              },
            });
          }

          // Check for NonRetriableError or StepError with noRetry
          const noRetryValue =
            isNonRetriableError(error) || (isStepError(error) && (error as StepError).noRetry === true);
          const noRetry = noRetryValue ? "true" : "false";
          if (drained.length > 0) {
            return ExecutionResult.make({
              status: 206,
              body: encodeOpcodes(drained),
              headers: { ...headers, [Protocol.Headers.NoRetry]: noRetry },
            });
          }
          // Spec §4.4.3: non-retriable function errors MUST return 400 with
          // the error payload at the response root; retriable errors return
          // 500 with the same root shape.
          return ExecutionResult.make({
            status: noRetryValue ? 400 : 500,
            body: toUserError(error),
            headers: { ...headers, [Protocol.Headers.NoRetry]: noRetry },
          });
        }),
      ),

      Effect.catchDefect((defect) =>
        Effect.gen(function* () {
          const drained = yield* drainBuffer;
          if (drained.length > 0) {
            return ExecutionResult.make({
              status: 206,
              body: encodeOpcodes(drained),
              headers: { ...headers, [Protocol.Headers.NoRetry]: "false" },
            });
          }
          return ExecutionResult.make({
            status: 500,
            body: toUserError(defect),
            headers: { ...headers, [Protocol.Headers.NoRetry]: "false" },
          });
        }),
      ),
    );

    return result;
  }).pipe(
    (base) => {
      const headers: Record<string, string> = {};
      if (traceHeaders.traceparent) {
        headers["traceparent"] = traceHeaders.traceparent;
      }
      if (traceHeaders.tracestate) {
        headers["tracestate"] = traceHeaders.tracestate;
      }
      return pipe(
        HttpTraceContext.fromHeaders(Headers.fromInput(headers)),
        Option.match({
          onNone: () => base,
          onSome: (externalSpan) => Effect.withParentSpan(base, externalSpan),
        }),
      );
    },
    Effect.withSpan(`inngest.function/${fn._tag}`, {
      kind: "server",
      attributes: {
        [OtelAttributes.RunId]: request.ctx.run_id,
        [OtelAttributes.FunctionId]: fn._tag,
        [OtelAttributes.AppId]: appName,
        [OtelAttributes.Attempt]: request.ctx.attempt,
      },
    }),
  );

export interface DriverService {
  readonly execute: <F extends InngestFunction.Any, R>(
    fn: F,
    handler: (ctx: HandlerContext<F>) => Effect.Effect<InngestFunction.Success<F>, unknown, R>,
    request: Protocol.SDKRequestBody,
    checkpointConfig?: Option.Option<CheckpointConfig>,
  ) => Effect.Effect<ExecutionResult, never, R | InngestClient>;
}

export class Driver extends Context.Service<Driver, DriverService>()("effect-inngest/Driver") {}

export const layer = (options: { readonly appName: string }): Layer.Layer<Driver> =>
  Layer.succeed(Driver, {
    execute: <F extends InngestFunction.Any, R>(
      fn: F,
      handler: (ctx: HandlerContext<F>) => Effect.Effect<InngestFunction.Success<F>, unknown, R>,
      request: Protocol.SDKRequestBody,
      checkpointConfig: Option.Option<CheckpointConfig> = Option.none(),
    ) => execute(fn, handler, request, options.appName, {}, checkpointConfig),
  });
