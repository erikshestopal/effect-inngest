import { Effect, Predicate, Schema } from "effect";
import type { ExecutionInput } from "../../domain/ExecutionInput.js";
import * as StepCommand from "../../domain/StepCommand.js";
import { InngestTimestamp } from "../../wire/Timestamp.js";
import { StepIdentity, type StepReservation } from "../StepIdentity.js";
import { StepCommandBus } from "../StepCommandBus.js";

export const sleepUntil = (args: {
  readonly input: ExecutionInput;
  readonly id: StepReservation;
  readonly timestamp: Date | number | string;
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
      duration: Schema.decodeUnknownSync(InngestTimestamp)(args.timestamp),
    });

    if (yield* bus.planCheckpointedFork(command)) {
      return;
    }

    return yield* bus.suspend(command);
  });
