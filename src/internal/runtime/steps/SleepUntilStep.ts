import { Effect, Option, Predicate, Schema } from "effect";
import type { ExecutionInput } from "../../domain/ExecutionInput.js";
import type { StepInput } from "../../domain/StepInput.js";
import * as StepCommand from "../../domain/StepCommand.js";
import { InngestTimestamp } from "../../wire/Timestamp.js";
import { CurrentCheckpoint } from "../CheckpointContext.js";
import { HandlerFiberScope } from "../HandlerFiberScope.js";
import { StepIdentity } from "../StepIdentity.js";
import { StepCommandSink } from "../StepCommandSink.js";

export const sleepUntil = (args: {
  readonly input: ExecutionInput;
  readonly id: StepInput;
  readonly timestamp: Date | number | string;
}) =>
  Effect.gen(function* () {
    const identity = yield* StepIdentity;
    const sink = yield* StepCommandSink;
    const info = yield* identity.resolve(args.id);
    const memo = args.input.memoForStep(info);

    if (!Predicate.isTagged(memo, "MemoNone")) {
      return;
    }

    if (!args.input.shouldExecuteStep(info)) {
      return;
    }

    const command = StepCommand.Sleep.make({
      info,
      duration: Schema.decodeUnknownSync(InngestTimestamp)(args.timestamp),
    });

    const checkpoint = yield* CurrentCheckpoint;
    const scope = yield* HandlerFiberScope;
    const isForkedFromHandlerRoot = yield* scope.isForkedFromHandlerRoot;

    if (args.input.isFunctionRun() && Option.isSome(checkpoint) && isForkedFromHandlerRoot) {
      return yield* sink.planCommand(command);
    }

    return yield* sink.yieldCommand(command);
  });
