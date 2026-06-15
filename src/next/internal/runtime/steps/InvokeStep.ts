import { Duration, Effect, Match, Predicate, Schema } from "effect";
import type { InngestFunction } from "../../../../Function.js";
import { StepError } from "../../../../internal/errors.js";
import * as StepResult from "../../codec/StepResult.js";
import { InngestDuration } from "../../wire/Duration.js";
import type { ExecutionInput } from "../../domain/ExecutionInput.js";
import type { StepInput } from "../../domain/StepInput.js";
import * as StepCommand from "../../domain/StepCommand.js";
import type { InvokeOptions, JsonSchema } from "../StepTools.js";
import { StepIdentity } from "../StepIdentity.js";
import { StepCommandSink } from "../StepCommandSink.js";
import * as StepOperation from "./StepOperation.js";

export const invoke = <F extends InngestFunction.Any>(args: {
  readonly input: ExecutionInput;
  readonly appName: string;
  readonly id: StepInput;
  readonly options: InvokeOptions<F>;
}): Effect.Effect<InngestFunction.Success<F>, StepError, StepIdentity | StepCommandSink> =>
  Effect.gen(function* () {
    const identity = yield* StepIdentity;
    const sink = yield* StepCommandSink;
    const info = yield* identity.resolve(args.id);
    const memo = StepOperation.memoFor({ input: args.input, info });

    return yield* Match.value(memo).pipe(
      Match.tag("MemoData", ({ data }) =>
        Schema.decodeUnknownEffect(
          Schema.toCodecJson(args.options.function.success as JsonSchema<InngestFunction.Success<F>>),
        )(data).pipe(Effect.mapError((cause) => StepResult.stepDecodeError({ stepId: info.id, cause }))),
      ),
      Match.tag("MemoError", ({ error }) =>
        Effect.fail(
          StepError.make({
            stepId: info.id,
            message: Predicate.hasProperty(error, "message") ? String(error.message) : "Invoke failed",
            cause: error,
          }),
        ),
      ),
      Match.tag("MemoTimeout", () =>
        Effect.fail(StepError.make({ stepId: info.id, message: "Invoke timed out", noRetry: true })),
      ),
      Match.tag("MemoInput", () => Effect.succeed(undefined as InngestFunction.Success<F>)),
      Match.tag("MemoNone", () =>
        Effect.gen(function* () {
          if (StepOperation.shouldPlan({ input: args.input, info })) {
            yield* sink.submit(StepCommand.StepPlanned.make({ info, kind: "run" }));
            return undefined as InngestFunction.Success<F>;
          }

          const data = Predicate.hasProperty(args.options, "data") ? args.options.data : undefined;

          yield* sink.submit(
            StepCommand.InvokeFunction.make({
              info,
              functionId: `${args.appName}-${args.options.function._tag}`,
              payload: {
                data,
                ...(Predicate.isNotUndefined(args.options.user) ? { user: args.options.user } : {}),
                ...(Predicate.isNotUndefined(args.options.v) ? { v: args.options.v } : {}),
              },
              timeout: args.options.timeout
                ? Schema.encodeSync(InngestDuration)(Duration.fromInputUnsafe(args.options.timeout))
                : undefined,
            }),
          );
          return undefined as InngestFunction.Success<F>;
        }),
      ),
      Match.exhaustive,
    );
  });
