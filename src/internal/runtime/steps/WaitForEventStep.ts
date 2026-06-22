import { Duration, Effect, Match, Option, Schema } from "effect";
import type * as InngestEvent from "../../../Event.js";
import * as EventPayload from "../../codec/EventPayload.js";
import * as StepResult from "../../codec/StepResult.js";
import { InngestDuration } from "../../wire/Duration.js";
import type { StepError } from "../../errors.js";
import type { ExecutionInput } from "../../domain/ExecutionInput.js";
import * as StepCommand from "../../domain/StepCommand.js";
import type { WaitForEventOptions } from "../StepTools.js";
import { StepIdentity, type StepReservation } from "../StepIdentity.js";
import { StepCommandBus } from "../StepCommandBus.js";

export const waitForEvent = <E extends EventPayload.EventSchema>(args: {
  readonly input: ExecutionInput;
  readonly id: StepReservation;
  readonly event: E;
  readonly options: WaitForEventOptions;
}): Effect.Effect<Option.Option<InngestEvent.EventType<E>>, StepError, StepIdentity | StepCommandBus> =>
  Effect.gen(function* () {
    const identity = yield* StepIdentity;
    const bus = yield* StepCommandBus;
    const info = yield* identity.resolve(args.id);
    const memo = args.input.memoForStep(info);

    return yield* Match.value(memo).pipe(
      Match.tag("MemoData", ({ data }) =>
        StepResult.orStepDecodeError(EventPayload.decodeMemoData(args.event)(data), { stepId: info.id }).pipe(
          Effect.map(Option.some),
        ),
      ),
      Match.tag("MemoTimeout", () => Effect.succeed(Option.none())),
      Match.tag("MemoError", ({ error }) => StepResult.failDecode({ stepId: info.id, cause: error })),
      Match.tag("MemoInput", ({ input }) => StepResult.failDecode({ stepId: info.id, cause: input })),
      Match.tag("MemoNone", () =>
        Effect.gen(function* () {
          if (!args.input.shouldExecuteStep(info)) {
            return Option.none();
          }

          yield* bus.suspend(
            StepCommand.WaitForEvent.make({
              info,
              sequence: args.id.sequence,
              event: args.event.identifier,
              timeout: Schema.encodeSync(InngestDuration)(Duration.fromInputUnsafe(args.options.timeout)),
              if: args.options.if,
            }),
          );
          return Option.none();
        }),
      ),
      Match.exhaustive,
    );
  });
