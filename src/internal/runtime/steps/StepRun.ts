import { Duration, Effect, Match, Option, Predicate, Schema } from "effect";
import { isNonRetriableError, isRetryAfterError, StepError } from "../../errors.js";
import * as StepResult from "../../codec/StepResult.js";
import type { ExecutionInput } from "../../domain/ExecutionInput.js";
import { CurrentExecutionInput } from "../../domain/ExecutionInput.js";
import * as StepCommand from "../../domain/StepCommand.js";
import { CurrentCheckpoint } from "../CheckpointContext.js";
import { HandlerFiberScope } from "../HandlerFiberScope.js";
import type { JsonSchema, RunOptions } from "../StepTools.js";
import { StepIdentity, type StepReservation } from "../StepIdentity.js";
import { StepCommandBus } from "../StepCommandBus.js";

export function run<Err, R>(args: {
  readonly input: ExecutionInput;
  readonly id: StepReservation;
  readonly effect: Effect.Effect<void, Err, R>;
}): Effect.Effect<
  void,
  StepError | Err,
  R | StepIdentity | StepCommandBus | typeof CurrentCheckpoint | CurrentExecutionInput | HandlerFiberScope
>;
export function run<S extends JsonSchema, Err, R>(args: {
  readonly input: ExecutionInput;
  readonly id: StepReservation;
  readonly effect: Effect.Effect<S["Type"], Err, R>;
  readonly options: RunOptions<S>;
}): Effect.Effect<
  S["Type"],
  StepError | Err,
  R | StepIdentity | StepCommandBus | typeof CurrentCheckpoint | CurrentExecutionInput | HandlerFiberScope
>;
export function run<S extends JsonSchema, Err, R>(args: {
  readonly input: ExecutionInput;
  readonly id: StepReservation;
  readonly effect: Effect.Effect<S["Type"] | void, Err, R>;
  readonly options?: RunOptions<S>;
}): Effect.Effect<
  void | S["Type"],
  StepError | Err,
  R | StepIdentity | StepCommandBus | typeof CurrentCheckpoint | CurrentExecutionInput | HandlerFiberScope
> {
  const decodeMemo = (data: unknown, stepId: string): Effect.Effect<void | S["Type"], StepError> => {
    if (args.options) {
      const schema: Schema.Codec<S["Type"], Schema.Json, never, never> = Schema.toCodecJson(args.options.schema);
      return Schema.decodeUnknownEffect(schema)(data).pipe(
        Effect.mapError((cause) => StepResult.stepDecodeError({ stepId, cause })),
      );
    }
    return Effect.void;
  };

  const encodeResult = (value: unknown, stepId: string) =>
    args.options
      ? Schema.encodeUnknownEffect(Schema.toCodecJson(args.options.schema))(value).pipe(
          Effect.mapError((cause) => StepResult.stepDecodeError({ stepId, cause })),
        )
      : Effect.succeed(undefined);

  return Effect.gen(function* () {
    const identity = yield* StepIdentity;
    const bus = yield* StepCommandBus;
    const info = yield* identity.resolve(args.id);
    const memo = args.input.memoForStep(info);

    return yield* Match.value(memo).pipe(
      Match.tag("MemoData", ({ data }) => decodeMemo(data, info.id)),
      Match.tag("MemoError", ({ error }) =>
        Effect.fail(
          StepError.make({
            stepId: info.id,
            message: Predicate.hasProperty(error, "message") ? String(error.message) : "Step failed",
            noRetry: true,
            cause: error,
          }),
        ),
      ),
      Match.tag("MemoTimeout", () =>
        Effect.fail(StepError.make({ stepId: info.id, message: "Step timed out", noRetry: true })),
      ),
      Match.tag("MemoInput", () =>
        Effect.fail(StepError.make({ stepId: info.id, message: "Unexpected step result type: input" })),
      ),
      Match.tag("MemoNone", () =>
        Effect.gen(function* () {
          if (!args.input.shouldExecuteStep(info)) {
            return yield* Effect.void;
          }

          const planned = StepCommand.StepRunPlanned.make({ info, sequence: args.id.sequence });

          if (args.input.shouldPlanStep(info)) {
            yield* bus.plan(planned);
            return yield* Effect.void;
          }

          const checkpoint = yield* CurrentCheckpoint;
          if (Option.isSome(checkpoint) && args.input.isFunctionRun() && (yield* checkpoint.value.isRuntimeExceeded)) {
            yield* checkpoint.value.flush;
            yield* bus.plan(planned);
            return yield* Effect.interrupt;
          }

          if (yield* bus.planCheckpointedFork(planned)) {
            return yield* Effect.void;
          }

          return yield* args.effect.pipe(
            Effect.matchEffect({
              onFailure: (err) => {
                const noRetry = isNonRetriableError(err) ? true : undefined;
                const retryAfterMs = isRetryAfterError(err) ? Duration.toMillis(err.retryAfter) : undefined;
                return noRetry === true || args.input.run.attempt >= args.input.run.maxAttempts - 1
                  ? bus.fail(StepCommand.StepRunFailed.make({ info, error: err }))
                  : bus.fail(StepCommand.StepRunError.make({ info, error: err, noRetry, retryAfterMs }));
              },
              onSuccess: (value) =>
                Effect.gen(function* () {
                  const data = yield* encodeResult(value, info.id);

                  yield* bus.complete(StepCommand.StepRunResult.make({ info, data }));
                  return yield* decodeMemo(data, info.id);
                }),
            }),
            Effect.catchDefect((defect) => bus.fail(StepCommand.StepRunError.make({ info, error: defect }))),
          );
        }),
      ),
      Match.exhaustive,
    );
  });
}
