import { Duration, Effect, Match, Option, Predicate, Schema } from "effect";
import { isNonRetriableError, isRetryAfterError, StepError } from "../../../../internal/errors.js";
import { errorInterrupt, failedInterrupt, StepInterrupt } from "../../../../internal/interrupts.js";
import * as StepResult from "../../codec/StepResult.js";
import type { ExecutionInput } from "../../domain/ExecutionInput.js";
import type { StepInput } from "../../domain/StepInput.js";
import * as StepCommand from "../../domain/StepCommand.js";
import { CurrentCheckpoint } from "../CheckpointContext.js";
import { HandlerFiberScope } from "../HandlerFiberScope.js";
import type { JsonSchema, RunOptions, RunOutput } from "../StepTools.js";
import { StepIdentity } from "../StepIdentity.js";
import { StepCommandSink } from "../StepCommandSink.js";

const isStepInterrupt = Schema.is(StepInterrupt);

export const run = <A, Err, R>(args: {
  readonly input: ExecutionInput;
  readonly id: StepInput;
  readonly effect: Effect.Effect<A, Err, R>;
  readonly options?: RunOptions<JsonSchema<A>>;
}) =>
  Effect.gen(function* () {
    const identity = yield* StepIdentity;
    const sink = yield* StepCommandSink;
    const info = yield* identity.resolve(args.id);
    const memo = args.input.memoForStep(info);

    return yield* Match.value(memo).pipe(
      Match.tag("MemoData", ({ data }) =>
        args.options?.schema
          ? Schema.decodeUnknownEffect(Schema.toCodecJson(args.options.schema))(data).pipe(
              Effect.mapError((cause) => StepResult.stepDecodeError({ stepId: info.id, cause })),
            )
          : Effect.succeed(data as RunOutput<A>),
      ),
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

          if (args.input.shouldPlanStep(info)) {
            yield* sink.planCommand(StepCommand.StepRunPlanned.make({ info }));
            return yield* Effect.void;
          }

          const checkpoint = yield* CurrentCheckpoint;
          if (Option.isSome(checkpoint) && args.input.isFunctionRun() && (yield* checkpoint.value.isRuntimeExceeded)) {
            yield* checkpoint.value.flush;
            yield* sink.planCommand(StepCommand.StepRunPlanned.make({ info }));
            return yield* Effect.interrupt;
          }

          const scope = yield* HandlerFiberScope;
          if (args.input.isFunctionRun() && Option.isSome(checkpoint) && (yield* scope.isForkedFromHandlerRoot)) {
            yield* sink.planCommand(StepCommand.StepRunPlanned.make({ info }));
            return yield* Effect.void;
          }

          return yield* args.effect.pipe(
            Effect.matchEffect({
              onFailure: (err) => {
                const noRetry = isNonRetriableError(err) ? true : undefined;
                const retryAfterMs = isRetryAfterError(err) ? Duration.toMillis(err.retryAfter) : undefined;
                return Effect.die(
                  noRetry === true || args.input.run.attempt >= args.input.run.maxAttempts - 1
                    ? failedInterrupt({ info, error: err })
                    : errorInterrupt({ info, error: err, noRetry, retryAfterMs }),
                );
              },
              onSuccess: (value) =>
                Effect.gen(function* () {
                  const data = Predicate.isUndefined(value)
                    ? undefined
                    : args.options?.schema
                      ? yield* Schema.encodeEffect(Schema.toCodecJson(args.options.schema))(value).pipe(
                          Effect.mapError((cause) => StepResult.stepDecodeError({ stepId: info.id, cause })),
                        )
                      : yield* StepResult.encodeUnknownJson({ value, stepId: info.id });

                  yield* sink.recordResult(StepCommand.StepRunResult.make({ info, data }));
                  return args.options?.schema ? value : (data as RunOutput<A>);
                }),
            }),
            Effect.catchDefect((defect) =>
              isStepInterrupt(defect) ? Effect.die(defect) : Effect.die(errorInterrupt({ info, error: defect })),
            ),
          );
        }),
      ),
      Match.exhaustive,
    );
  });
