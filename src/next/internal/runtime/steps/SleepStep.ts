import { Duration, Effect, Predicate, Schema } from "effect";
import { InngestDuration } from "../../wire/Duration.js";
import type { ExecutionInput } from "../../domain/ExecutionInput.js";
import type { StepInput } from "../../domain/StepInput.js";
import * as StepCommand from "../../domain/StepCommand.js";
import { StepIdentity } from "../StepIdentity.js";
import { StepCommandSink } from "../StepCommandSink.js";
import * as StepOperation from "./StepOperation.js";

export const sleep = (args: {
  readonly input: ExecutionInput;
  readonly id: StepInput;
  readonly duration: Duration.Input;
}): Effect.Effect<void, never, StepIdentity | StepCommandSink> =>
  Effect.gen(function* () {
    const identity = yield* StepIdentity;
    const sink = yield* StepCommandSink;
    const info = yield* identity.resolve(args.id);

    if (!Predicate.isTagged(StepOperation.memoFor({ input: args.input, info }), "MemoNone")) {
      return;
    }

    if (StepOperation.shouldPlan({ input: args.input, info })) {
      return yield* sink.submit(StepCommand.StepPlanned.make({ info, kind: "run" }));
    }

    return yield* sink.submit(
      StepCommand.Sleep.make({
        info,
        duration: Schema.encodeSync(InngestDuration)(Duration.fromInputUnsafe(args.duration)),
      }),
    );
  });
