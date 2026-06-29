import { Effect, Match } from "effect";
import type { StepError } from "../../errors.js";
import * as StepResult from "../../codec/StepResult.js";
import type { ExecutionInput } from "../../domain/ExecutionInput.js";
import { CurrentExecutionInput } from "../../domain/ExecutionInput.js";
import * as StepCommand from "../../domain/StepCommand.js";
import * as SafeStringify from "../../utils/safe-stringify.js";
import { HandlerFiberScope } from "../HandlerFiberScope.js";
import { StepIdentity, type StepReservation } from "../StepIdentity.js";
import { StepCommandBus } from "../StepCommandBus.js";

export function run<A, Err, R>(args: {
  readonly input: ExecutionInput;
  readonly id: StepReservation;
  readonly effect: Effect.Effect<A, Err, R>;
}): Effect.Effect<A, StepError | Err, R | StepIdentity | StepCommandBus | CurrentExecutionInput | HandlerFiberScope> {
  return Effect.gen(function* () {
    const identity = yield* StepIdentity;
    const bus = yield* StepCommandBus;
    const info = yield* identity.resolve(args.id);
    const memo = args.input.memoForStep(info);

    return yield* Match.value(memo).pipe(
      Match.tag("MemoData", ({ data }) => Effect.succeed(data as A)),
      Match.tag("MemoError", ({ error }) => StepResult.failStepRunMemoError(info.id, error)),
      Match.tag("MemoTimeout", () => StepResult.failStepRunMemoTimeout(info.id)),
      Match.tag("MemoInput", ({ input }) => StepResult.failUnexpectedStepRunMemoInput(info.id, input)),
      Match.tag("MemoNone", () =>
        Effect.gen(function* () {
          if (!args.input.shouldExecuteStep(info)) {
            return yield* Effect.interrupt;
          }

          const planned = StepCommand.StepRunPlanned.make({ info, sequence: args.id.sequence });

          if (args.input.shouldPlanStep(info)) {
            yield* bus.plan(planned);
            return yield* Effect.interrupt;
          }

          if (yield* bus.planCheckpointedRunBoundary(planned)) {
            return yield* Effect.interrupt;
          }

          return yield* args.effect.pipe(
            Effect.matchEffect({
              onFailure: (error) =>
                Effect.gen(function* () {
                  yield* bus.fail(
                    StepCommand.stepRunFailureForAttempt({
                      info,
                      error,
                      attempt: args.input.run.attempt,
                      maxAttempts: args.input.run.maxAttempts,
                    }),
                  );
                  return yield* Effect.interrupt;
                }),
              onSuccess: (value) =>
                Effect.gen(function* () {
                  const data = SafeStringify.normalize(value);

                  yield* bus.complete(StepCommand.StepRunResult.make({ info, data }));
                  return data as A;
                }),
            }),
            Effect.catchDefect((defect) =>
              Effect.gen(function* () {
                yield* bus.fail(StepCommand.StepRunError.make({ info, error: defect }));
                return yield* Effect.interrupt;
              }),
            ),
          );
        }),
      ),
      Match.exhaustive,
    );
  });
}
