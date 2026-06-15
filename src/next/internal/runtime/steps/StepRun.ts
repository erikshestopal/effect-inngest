import { Effect, Match, Predicate, Schema } from "effect";
import { StepError } from "../../../../internal/errors.js";
import * as StepResult from "../../codec/StepResult.js";
import type { ExecutionInput } from "../../domain/ExecutionInput.js";
import type { StepInput } from "../../domain/StepInput.js";
import * as StepCommand from "../../domain/StepCommand.js";
import type { JsonSchema, RunOptions, RunOutput } from "../StepTools.js";
import { StepIdentity } from "../StepIdentity.js";
import { StepCommandSink } from "../StepCommandSink.js";
import * as StepOperation from "./StepOperation.js";

export const run = <A, Err, R>(args: {
  readonly input: ExecutionInput;
  readonly id: StepInput;
  readonly effect: Effect.Effect<A, Err, R>;
  readonly options?: RunOptions<JsonSchema<A>>;
}): Effect.Effect<A | RunOutput<A>, StepError | Err, R | StepIdentity | StepCommandSink> =>
  Effect.gen(function* () {
    const identity = yield* StepIdentity;
    const sink = yield* StepCommandSink;
    const info = yield* identity.resolve(args.id);
    const memo = StepOperation.memoFor({ input: args.input, info });

    return yield* Match.value(memo).pipe(
      Match.tag("MemoData", ({ data }) =>
        args.options?.schema
          ? Schema.decodeUnknownEffect(Schema.toCodecJson(args.options.schema))(data).pipe(
              Effect.mapError((cause) => StepResult.stepDecodeError({ stepId: info.id, cause })),
            )
          : Effect.succeed(data as RunOutput<A>),
      ),
      Match.tag("MemoError", ({ error }) =>
        Effect.fail(
          StepError.make({
            stepId: info.id,
            message: Predicate.hasProperty(error, "message") ? String(error.message) : "Step failed",
            noRetry: true,
            cause: error,
          }),
        ),
      ),
      Match.tag("MemoTimeout", () =>
        Effect.fail(StepError.make({ stepId: info.id, message: "Step timed out", noRetry: true })),
      ),
      Match.tag("MemoInput", () =>
        Effect.fail(StepError.make({ stepId: info.id, message: "Unexpected step result type: input" })),
      ),
      Match.tag("MemoNone", () =>
        Effect.gen(function* () {
          if (StepOperation.shouldPlan({ input: args.input, info })) {
            yield* sink.submit(StepCommand.StepPlanned.make({ info, kind: "run" }));
            return undefined as unknown as RunOutput<A>;
          }

          const value = yield* args.effect;
          const data = Predicate.isUndefined(value)
            ? undefined
            : args.options?.schema
              ? yield* Schema.encodeEffect(Schema.toCodecJson(args.options.schema))(value).pipe(
                  Effect.mapError((cause) => StepResult.stepDecodeError({ stepId: info.id, cause })),
                )
              : yield* StepResult.encodeUnknownJson({ value, stepId: info.id });

          yield* sink.submit(StepCommand.StepRunResult.make({ info, data }));
          return args.options?.schema ? value : (data as RunOutput<A>);
        }),
      ),
      Match.exhaustive,
    );
  });
