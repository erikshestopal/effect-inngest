import { Effect, Predicate, Schema } from "effect";
import type { ExecutionInput } from "../../domain/ExecutionInput.js";
import type { StepInput } from "../../domain/StepInput.js";
import * as StepCommand from "../../domain/StepCommand.js";
import { InngestTimestamp } from "../../wire/Timestamp.js";
import { StepIdentity } from "../StepIdentity.js";
import { StepCommandSink } from "../StepCommandSink.js";
import * as StepOperation from "./StepOperation.js";

export const sleepUntil = (args: {
  readonly input: ExecutionInput;
  readonly id: StepInput;
  readonly timestamp: Date | number | string;
}) =>
  Effect.gen(function* () {
    const identity = yield* StepIdentity;
    const sink = yield* StepCommandSink;
    const info = yield* identity.resolve(args.id);
    const memo = StepOperation.memoFor({ input: args.input, info });

    if (!Predicate.isTagged(memo, "MemoNone")) {
      return;
    }

    if (StepOperation.shouldPlan({ input: args.input, info })) {
      return yield* sink.planCommand(StepCommand.StepRunPlanned.make({ info }));
    }

    const command = StepCommand.Sleep.make({
      info,
      duration: Schema.decodeUnknownSync(InngestTimestamp)(args.timestamp),
    });
    return yield* sink.yieldCommand(command);
  });
