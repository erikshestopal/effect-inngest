import { Duration, Effect, Predicate, Schema } from "effect";
import { InngestDuration } from "../../wire/Duration.js";
import type { ExecutionInput } from "../../domain/ExecutionInput.js";
import * as StepCommand from "../../domain/StepCommand.js";
import { StepIdentity, type StepReservation } from "../StepIdentity.js";
import { StepCommandBus } from "../StepCommandBus.js";

export const sleep = (args: {
  readonly input: ExecutionInput;
  readonly id: StepReservation;
  readonly duration: Duration.Input;
}) =>
  Effect.gen(function* () {
    const identity = yield* StepIdentity;
    const bus = yield* StepCommandBus;
    const info = yield* identity.resolve(args.id);
    const memo = args.input.memoForStep(info);

    if (!Predicate.isTagged(memo, "MemoNone") || !args.input.shouldExecuteStep(info)) {
      return;
    }

    const command = StepCommand.Sleep.make({
      info,
      sequence: args.id.sequence,
      duration: Schema.encodeSync(InngestDuration)(Duration.fromInputUnsafe(args.duration)),
    });

    if (yield* bus.planCheckpointedFork(command)) {
      return;
    }

    return yield* bus.suspend(command);
  });
