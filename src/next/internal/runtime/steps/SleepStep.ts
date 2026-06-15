import { Duration, Effect, Option, Predicate, Schema } from "effect";
import { InngestDuration } from "../../wire/Duration.js";
import type { ExecutionInput } from "../../domain/ExecutionInput.js";
import type { StepInput } from "../../domain/StepInput.js";
import * as StepCommand from "../../domain/StepCommand.js";
import { CurrentCheckpoint } from "../CheckpointContext.js";
import { HandlerFiberScope } from "../HandlerFiberScope.js";
import { StepIdentity } from "../StepIdentity.js";
import { StepCommandSink } from "../StepCommandSink.js";
import * as StepOperation from "./StepOperation.js";

export const sleep = (args: {
  readonly input: ExecutionInput;
  readonly id: StepInput;
  readonly duration: Duration.Input;
}) =>
  Effect.gen(function* () {
    const identity = yield* StepIdentity;
    const sink = yield* StepCommandSink;
    const info = yield* identity.resolve(args.id);
    const memo = StepOperation.memoFor({ input: args.input, info });

    if (!Predicate.isTagged(memo, "MemoNone")) {
      return;
    }

    const command = StepCommand.Sleep.make({
      info,
      duration: Schema.encodeSync(InngestDuration)(Duration.fromInputUnsafe(args.duration)),
    });

    const checkpoint = yield* CurrentCheckpoint;
    const scope = yield* HandlerFiberScope;
    const isForkedFromHandlerRoot = yield* scope.isForkedFromHandlerRoot;

    if (args.input.stepId === "step" && Option.isSome(checkpoint) && isForkedFromHandlerRoot) {
      return yield* sink.planCommand(command);
    }

    return yield* sink.yieldCommand(command);
  });
