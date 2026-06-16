import { Duration, Effect, Match, Predicate, Schema } from "effect";
import { InngestConfig } from "../../../../Client.js";
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

export const invoke = <F extends InngestFunction.Any>(args: {
  readonly input: ExecutionInput;
  readonly id: StepInput;
  readonly options: InvokeOptions<F>;
}) =>
  Effect.gen(function* () {
    const config = yield* InngestConfig;
    const identity = yield* StepIdentity;
    const sink = yield* StepCommandSink;
    const info = yield* identity.resolve(args.id);
    const memo = args.input.memoForStep(info);

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
      Match.tag("MemoInput", () => Effect.succeed(undefined)),
      Match.tag("MemoNone", () =>
        Effect.gen(function* () {
          if (!args.input.shouldExecuteStep(info)) {
            return yield* Effect.void;
          }

          const event = Predicate.hasProperty(args.options, "data") ? args.options.data : undefined;
          const data = Predicate.isObject(event) && Predicate.hasProperty(event, "data") ? event.data : event;

          yield* sink.yieldCommand(
            StepCommand.InvokeFunction.make({
              info,
              functionId: `${config.id}-${args.options.function._tag}`,
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
          return yield* Effect.void;
        }),
      ),
      Match.exhaustive,
    );
  });
