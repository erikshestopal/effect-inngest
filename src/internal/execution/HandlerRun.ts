import { Effect, Option, Schema } from "effect";
import type { InngestFunction } from "../../Function.js";
import * as HandlerContext from "../runtime/HandlerContext.js";
import { CurrentCheckpoint } from "../runtime/CheckpointContext.js";
import * as SafeStringify from "../utils/safe-stringify.js";

export class HandlerSucceeded extends Schema.TaggedClass<HandlerSucceeded>()("HandlerSucceeded", {
  value: Schema.Unknown,
}) {}

export class CheckpointDeadlineElapsed extends Schema.TaggedClass<CheckpointDeadlineElapsed>()(
  "CheckpointDeadlineElapsed",
  {},
) {}

export type HandlerCompletion = HandlerSucceeded | CheckpointDeadlineElapsed;

export const run = <F extends InngestFunction.Any, R>(args: {
  readonly fn: F;
  readonly handler: (ctx: HandlerContext.HandlerContext<F>) => Effect.Effect<unknown, unknown, R>;
}) =>
  HandlerContext.make({ fn: args.fn }).pipe(
    Effect.flatMap(args.handler),
    Effect.map((value) => HandlerSucceeded.make({ value: SafeStringify.normalize(value) })),
  );

export const withCheckpointDeadline = <E, R>(effect: Effect.Effect<HandlerCompletion, E, R>) =>
  Effect.gen(function* () {
    const checkpoint = yield* CurrentCheckpoint;
    return yield* Option.match(checkpoint, {
      onNone: () => effect,
      onSome: (state) =>
        Effect.sleep(state.config.maxRuntime).pipe(
          Effect.andThen(state.markRuntimeExceeded),
          Effect.forkScoped,
          Effect.andThen(effect),
        ),
    });
  });
