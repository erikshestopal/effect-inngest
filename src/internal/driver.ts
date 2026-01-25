/**
 * Driver execution logic.
 * @internal
 */
import * as Headers from "@effect/platform/Headers";
import * as HttpTraceContext from "@effect/platform/HttpTraceContext";
import { Array as Arr, Chunk, Context, Duration, Effect, HashMap, Option, pipe, Predicate, Ref, Schema } from "effect";
import type { InngestFunction } from "../Function.js";
import { InngestClient } from "../Client.js";
import { isRetryAfterError, isNonRetriableError, isStepError, type RetryAfterError, type StepError } from "./errors.js";
import * as Protocol from "./protocol.js";
import { StepInterrupt } from "./interrupts.js";
import { createStepTools, buildHandlerContext, Step, type HandlerContext } from "./step.js";
import { OtelAttributes } from "./constants.js";

/** Trace context headers extracted from incoming request */
export interface TraceHeaders {
  readonly traceparent?: string;
  readonly tracestate?: string;
}

const SDK_VERSION = "2.0.0";

export class ExecutionResult extends Schema.Class<ExecutionResult>("ExecutionResult")({
  status: Schema.Literal(200, 206, 500),
  body: Schema.Unknown,
  headers: Schema.Record({ key: Schema.String, value: Schema.String }),
}) {}

const isStepInterrupt = Schema.is(StepInterrupt);

const isSomeWithValue = (v: unknown): v is { _tag: "Some"; value: unknown } =>
  Predicate.isRecord(v) && Predicate.hasProperty(v, "_tag") && v._tag === "Some" && Predicate.hasProperty(v, "value");

const extractStepInterrupt = (value: unknown): Option.Option<StepInterrupt> =>
  pipe(
    Option.liftPredicate(isStepInterrupt)(value),
    Option.orElse(() =>
      pipe(
        Option.liftPredicate(isSomeWithValue)(value),
        Option.flatMap((v) => Option.liftPredicate(isStepInterrupt)(v.value)),
      ),
    ),
  );

const collectStepInterruptsFromError = (error: unknown): Chunk.Chunk<StepInterrupt> =>
  pipe(
    extractStepInterrupt(error),
    Option.match({
      onSome: Chunk.of,
      onNone: () =>
        Array.isArray(error) ? Chunk.fromIterable(Arr.filterMap(error, extractStepInterrupt)) : Chunk.empty(),
    }),
  );

const toUserError = (error: unknown): typeof Protocol.UserError.Type =>
  Protocol.UserError.make({
    name: Predicate.hasProperty(error, "name") ? String(error.name) : "Error",
    message: Predicate.hasProperty(error, "message") ? String(error.message) : String(error),
    stack: Predicate.hasProperty(error, "stack") ? String(error.stack) : undefined,
  });

const baseHeaders = (): Record<string, string> => ({
  "Content-Type": "application/json",
  [Protocol.Headers.SDK]: `effect-inngest:v${SDK_VERSION}`,
  [Protocol.Headers.RequestVersion]: "1",
});

export const execute = <F extends InngestFunction.Any, R>(
  fn: F,
  handler: (ctx: HandlerContext<F>) => Effect.Effect<InngestFunction.Success<F>, unknown, R>,
  request: Protocol.SDKRequestBody,
  appName: string,
  traceHeaders: TraceHeaders = {},
): Effect.Effect<ExecutionResult, never, R | InngestClient> =>
  Effect.gen(function* () {
    const stepIdCounts = yield* Ref.make(HashMap.empty<string, number>());
    const step = createStepTools(request, appName, stepIdCounts);
    const context = buildHandlerContext<F>(fn, step, request);
    const headers = baseHeaders();

    const result = yield* handler(context).pipe(
      Effect.provideService(Step, step),
      Effect.map((value) => ExecutionResult.make({ status: 200, body: value, headers })),
      Effect.catchAll((error) => {
        const interrupts = collectStepInterruptsFromError(error);

        if (!Chunk.isEmpty(interrupts)) {
          const interruptArray = Chunk.toReadonlyArray(interrupts);
          const opcodes = interruptArray.map((interrupt) => interrupt.opcode);

          const hasNonRetriableError = opcodes.some(
            (op) =>
              op.op === Protocol.Opcode.StepError &&
              Predicate.isRecord(op.error) &&
              Predicate.hasProperty(op.error, "noRetry") &&
              op.error.noRetry === true,
          );

          const retryAfterMs = interruptArray.find((i) => i.retryAfterMs !== undefined)?.retryAfterMs;
          const responseHeaders: Record<string, string> = hasNonRetriableError
            ? { ...headers, [Protocol.Headers.NoRetry]: "true" }
            : headers;
          if (retryAfterMs !== undefined) {
            responseHeaders[Protocol.Headers.RetryAfter] = String(Math.ceil(retryAfterMs / 1000));
          }
          const encodedOpcodes = Schema.encodeSync(Schema.Array(Protocol.GeneratorOpcode))(opcodes);
          return Effect.succeed(ExecutionResult.make({ status: 206, body: encodedOpcodes, headers: responseHeaders }));
        }

        // Check for RetryAfterError - use type guard and direct access
        if (isRetryAfterError(error)) {
          const retryAfterMs = Duration.toMillis((error as RetryAfterError).retryAfter);
          const retryAfterSeconds = Math.ceil(retryAfterMs / 1000);
          return Effect.succeed(
            ExecutionResult.make({
              status: 500,
              body: { error: toUserError(error) },
              headers: {
                ...headers,
                [Protocol.Headers.NoRetry]: "false",
                [Protocol.Headers.RetryAfter]: String(retryAfterSeconds),
              },
            }),
          );
        }

        // Check for NonRetriableError or StepError with noRetry
        const noRetryValue =
          isNonRetriableError(error) || (isStepError(error) && (error as StepError).noRetry === true);
        const noRetry = noRetryValue ? "true" : "false";
        return Effect.succeed(
          ExecutionResult.make({
            status: 500,
            body: { error: toUserError(error) },
            headers: { ...headers, [Protocol.Headers.NoRetry]: noRetry },
          }),
        );
      }),

      Effect.catchAllDefect((defect) =>
        Effect.succeed(
          ExecutionResult.make({
            status: 500,
            body: { error: toUserError(defect) },
            headers: { ...headers, [Protocol.Headers.NoRetry]: "false" },
          }),
        ),
      ),
    );

    return result;
  }).pipe(
    (base) => {
      const headers: Record<string, string> = {};
      if (traceHeaders.traceparent) headers["traceparent"] = traceHeaders.traceparent;
      if (traceHeaders.tracestate) headers["tracestate"] = traceHeaders.tracestate;
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
  ) => Effect.Effect<ExecutionResult, never, R | InngestClient>;
}

export class Driver extends Context.Tag("effect-inngest/Driver")<Driver, DriverService>() {}

export const layer = (options: { readonly appName: string }) =>
  Effect.succeed({
    execute: <F extends InngestFunction.Any, R>(
      fn: F,
      handler: (ctx: HandlerContext<F>) => Effect.Effect<InngestFunction.Success<F>, unknown, R>,
      request: Protocol.SDKRequestBody,
    ) => execute(fn, handler, request, options.appName),
  }).pipe(Effect.map((service) => Context.make(Driver, service)));
