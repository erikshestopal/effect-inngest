import { Duration, Effect, Match, Option, Predicate, Schema } from "effect";
import type * as InngestEvent from "../../../../Event.js";
import * as EventPayload from "../../codec/EventPayload.js";
import * as StepResult from "../../codec/StepResult.js";
import { InngestDuration } from "../../wire/Duration.js";
import type { StepError } from "../../../../internal/errors.js";
import type { ExecutionInput } from "../../domain/ExecutionInput.js";
import type { StepInput } from "../../domain/StepInput.js";
import * as StepCommand from "../../domain/StepCommand.js";
import type { WaitForEventOptions } from "../StepTools.js";
import { StepIdentity } from "../StepIdentity.js";
import { StepCommandSink } from "../StepCommandSink.js";
import * as StepOperation from "./StepOperation.js";

export const waitForEvent = <E extends EventPayload.EventSchema>(args: {
  readonly input: ExecutionInput;
  readonly id: StepInput;
  readonly event: E;
  readonly options: WaitForEventOptions;
}): Effect.Effect<Option.Option<InngestEvent.EventType<E>>, StepError, StepIdentity | StepCommandSink> =>
  Effect.gen(function* () {
    const identity = yield* StepIdentity;
    const sink = yield* StepCommandSink;
    const info = yield* identity.resolve(args.id);
    const memo = StepOperation.memoFor({ input: args.input, info });

    return yield* Match.value(memo).pipe(
      Match.tag("MemoData", ({ data }) =>
        Option.match(Option.filter(Option.some(data), Predicate.isNotNullish), {
          onNone: () => Effect.succeed(Option.none()),
          onSome: (eventPayload) =>
            (
              Schema.decodeUnknownEffect(Schema.toCodecJson(args.event as Schema.Top))(eventPayload) as Effect.Effect<
                InngestEvent.EventType<E>
              >
            ).pipe(
              Effect.map((event) => Option.some(event as InngestEvent.EventType<E>)),
              Effect.mapError((cause) => StepResult.stepDecodeError({ stepId: info.id, cause })),
            ),
        }),
      ),
      Match.tag("MemoNone", () =>
        Effect.gen(function* () {
          yield* sink.yieldCommand(
            StepCommand.WaitForEvent.make({
              info,
              event: args.event.identifier,
              timeout: Schema.encodeSync(InngestDuration)(Duration.fromInputUnsafe(args.options.timeout)),
              if: args.options.if,
            }),
          );
          return Option.none();
        }),
      ),
      Match.orElse(() => Effect.succeed(Option.none())),
    );
  });
