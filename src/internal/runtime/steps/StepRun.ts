import { Effect, Match, Option, Schema } from "effect";
import type { StepError } from "../../errors.js";
import * as StepResult from "../../codec/StepResult.js";
import type { ExecutionInput } from "../../domain/ExecutionInput.js";
import { CurrentExecutionInput } from "../../domain/ExecutionInput.js";
import * as StepCommand from "../../domain/StepCommand.js";
import { HandlerFiberScope } from "../HandlerFiberScope.js";
import type { JsonSchema, RunOptions } from "../StepTools.js";
import { StepIdentity, type StepReservation } from "../StepIdentity.js";
import { StepCommandBus } from "../StepCommandBus.js";

export function run<Err, R>(args: {
  readonly input: ExecutionInput;
  readonly id: StepReservation;
  readonly effect: Effect.Effect<void, Err, R>;
}): Effect.Effect<void, StepError | Err, R | StepIdentity | StepCommandBus | CurrentExecutionInput | HandlerFiberScope>;
export function run<S extends JsonSchema, Err, R>(args: {
  readonly input: ExecutionInput;
  readonly id: StepReservation;
  readonly effect: Effect.Effect<S["Type"], Err, R>;
  readonly options: RunOptions<S>;
}): Effect.Effect<
  S["Type"],
  StepError | Err,
  R | StepIdentity | StepCommandBus | CurrentExecutionInput | HandlerFiberScope
>;
export function run<S extends JsonSchema, Err, R>(args: {
  readonly input: ExecutionInput;
  readonly id: StepReservation;
  readonly effect: Effect.Effect<S["Type"] | void, Err, R>;
  readonly options?: RunOptions<S>;
}): Effect.Effect<
  void | S["Type"],
  StepError | Err,
  R | StepIdentity | StepCommandBus | CurrentExecutionInput | HandlerFiberScope
> {
  const memoCodec: StepResult.OptionalMemoCodec<S["Type"]> = args.options
    ? Option.some(Schema.toCodecJson(args.options.schema))
    : Option.none();

  return Effect.gen(function* () {
    const identity = yield* StepIdentity;
    const bus = yield* StepCommandBus;
    const info = yield* identity.resolve(args.id);
    const memo = args.input.memoForStep(info);

    return yield* Match.value(memo).pipe(
      Match.tag("MemoData", ({ data }) => StepResult.decodeStepRunMemo(memoCodec, info.id)(data)),
      Match.tag("MemoError", ({ error }) => StepResult.failStepRunMemoError(info.id, error)),
      Match.tag("MemoTimeout", () => StepResult.failStepRunMemoTimeout(info.id)),
      Match.tag("MemoInput", ({ input }) => StepResult.failUnexpectedStepRunMemoInput(info.id, input)),
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

          if (yield* bus.planCheckpointedRunBoundary(planned)) {
            return yield* Effect.void;
          }

          return yield* args.effect.pipe(
            Effect.matchEffect({
              onFailure: (error) =>
                bus.fail(
                  StepCommand.stepRunFailureForAttempt({
                    info,
                    error,
                    attempt: args.input.run.attempt,
                    maxAttempts: args.input.run.maxAttempts,
                  }),
                ),
              onSuccess: (value) =>
                Effect.gen(function* () {
                  const data = yield* StepResult.encodeStepRunMemo(memoCodec, info.id)(value);

                  yield* bus.complete(StepCommand.StepRunResult.make({ info, data }));
                  return yield* StepResult.decodeStepRunMemo(memoCodec, info.id)(data);
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
