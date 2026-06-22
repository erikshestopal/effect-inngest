import { Array as Arr, Effect, Match, Predicate, Schema } from "effect";
import { InngestClient } from "../../../Client.js";
import { SendEventError } from "../../errors.js";
import type { ExecutionInput } from "../../domain/ExecutionInput.js";
import * as StepCommand from "../../domain/StepCommand.js";
import type { OutgoingEvent } from "../StepTools.js";
import { StepIdentity, type StepReservation } from "../StepIdentity.js";
import { StepCommandBus } from "../StepCommandBus.js";

const SendEventMemoData = Schema.Struct({ ids: Schema.Array(Schema.String) });

const sendEventDecodeError = (error: unknown) =>
  SendEventError.make({
    message: `Invalid sendEvent memo data: ${Predicate.hasProperty(error, "message") ? String(error.message) : String(error)}`,
    events: [],
  });

export const sendEvent = (args: {
  readonly input: ExecutionInput;
  readonly id: StepReservation;
  readonly payload: OutgoingEvent | ReadonlyArray<OutgoingEvent>;
}) =>
  Effect.gen(function* () {
    const identity = yield* StepIdentity;
    const bus = yield* StepCommandBus;
    const info = yield* identity.resolve(args.id);
    const memo = args.input.memoForStep(info);

    return yield* Match.value(memo).pipe(
      Match.tag("MemoData", ({ data }) =>
        Schema.decodeUnknownEffect(SendEventMemoData)(data).pipe(Effect.mapError(sendEventDecodeError)),
      ),
      Match.tag("MemoError", () => Effect.fail(SendEventError.make({ message: "SendEvent failed", events: [] }))),
      Match.tag("MemoTimeout", () => Effect.fail(SendEventError.make({ message: "SendEvent timed out", events: [] }))),
      Match.tag("MemoInput", () => Effect.succeed({ ids: [] })),
      Match.tag("MemoNone", () =>
        Effect.gen(function* () {
          if (!args.input.shouldExecuteStep(info)) {
            return { ids: [] };
          }

          const planned = StepCommand.SendEventPlanned.make({ info, sequence: args.id.sequence });

          if (args.input.shouldPlanStep(info)) {
            yield* bus.plan(planned);
            return { ids: [] };
          }

          if (yield* bus.planCheckpointedFork(planned)) {
            return { ids: [] };
          }

          const events = Arr.ensure(args.payload);
          const result = yield* InngestClient.use((client) => client.sendEvent(events));
          yield* bus.complete(
            StepCommand.SendEventResult.make({
              info,
              data: { ids: [...result.ids] },
              rawPayload: Arr.isArray(args.payload) ? events : events[0],
            }),
          );
          return result;
        }),
      ),
      Match.exhaustive,
    );
  });
