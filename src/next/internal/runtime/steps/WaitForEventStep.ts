import { Duration, Effect, Match, Option, Predicate, Schema } from "effect";
import type * as InngestEvent from "../../../../Event.js";
import type * as EventPayload from "../../codec/EventPayload.js";
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

const WaitForEventPayload = Schema.Struct({ data: Schema.Unknown });

const payloadFromMemo = (value: unknown): Option.Option<unknown> => {
  const payload = Schema.decodeUnknownOption(WaitForEventPayload)(value).pipe(
    Option.map((event) => event.data),
    Option.orElse(() => Option.some(value)),
  );
  return Option.filter(payload, Predicate.isNotNullish);
};

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
        Option.match(payloadFromMemo(data), {
          onNone: () => Effect.succeed(Option.none()),
          onSome: (payload) =>
            Schema.decodeUnknownEffect(Schema.toCodecJson(args.event as Schema.Top))(payload).pipe(
              Effect.map((event) => Option.some(event as InngestEvent.EventType<E>)),
              Effect.mapError((cause) => StepResult.stepDecodeError({ stepId: info.id, cause })),
            ) as Effect.Effect<Option.Option<InngestEvent.EventType<E>>, StepError>,
        }),
      ),
      Match.tag("MemoNone", () =>
        Effect.gen(function* () {
          if (StepOperation.shouldPlan({ input: args.input, info })) {
            yield* sink.submit(StepCommand.StepPlanned.make({ info, kind: "run" }));
            return Option.none();
          }
          yield* sink.submit(
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
