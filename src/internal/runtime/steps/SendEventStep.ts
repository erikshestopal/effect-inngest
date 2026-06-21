import { Array as Arr, Effect, Match, Option } from "effect";
import { SendEventError } from "../../errors.js";
import type { ExecutionInput } from "../../domain/ExecutionInput.js";
import * as StepCommand from "../../domain/StepCommand.js";
import { CurrentCheckpoint } from "../CheckpointContext.js";
import { EventApi, type OutgoingEvent } from "../EventApi.js";
import { HandlerFiberScope } from "../HandlerFiberScope.js";
import { StepIdentity, type StepReservation } from "../StepIdentity.js";
import { StepCommandBus } from "../StepCommandBus.js";

export const sendEvent = (args: {
  readonly input: ExecutionInput;
  readonly id: StepReservation;
  readonly payload: OutgoingEvent | ReadonlyArray<OutgoingEvent>;
}) =>
  Effect.gen(function* () {
    const identity = yield* StepIdentity;
    const bus = yield* StepCommandBus;
    const eventApi = yield* EventApi;
    const info = yield* identity.resolve(args.id);
    const memo = args.input.memoForStep(info);

    return yield* Match.value(memo).pipe(
      Match.tag("MemoData", ({ data }) => Effect.succeed(data as { readonly ids: ReadonlyArray<string> })),
      Match.tag("MemoError", () => Effect.fail(SendEventError.make({ message: "SendEvent failed", events: [] }))),
      Match.tag("MemoTimeout", () => Effect.fail(SendEventError.make({ message: "SendEvent timed out", events: [] }))),
      Match.tag("MemoInput", () => Effect.succeed({ ids: [] })),
      Match.tag("MemoNone", () =>
        Effect.gen(function* () {
          if (!args.input.shouldExecuteStep(info)) {
            return { ids: [] };
          }

          if (args.input.shouldPlanStep(info)) {
            yield* bus.plan(StepCommand.SendEventPlanned.make({ info, sequence: args.id.sequence }));
            return { ids: [] };
          }

          const checkpoint = yield* CurrentCheckpoint;
          const scope = yield* HandlerFiberScope;
          const isForkedFromHandlerRoot = yield* scope.isForkedFromHandlerRoot;

          if (args.input.isFunctionRun() && Option.isSome(checkpoint) && isForkedFromHandlerRoot) {
            yield* bus.plan(StepCommand.SendEventPlanned.make({ info, sequence: args.id.sequence }));
            return { ids: [] };
          }

          const events = Arr.ensure(args.payload);
          const result = yield* eventApi.send(events);
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
