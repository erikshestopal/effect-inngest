import { Array as Arr, Effect, Match } from "effect";
import { SendEventError } from "../../../../internal/errors.js";
import type { ExecutionInput } from "../../domain/ExecutionInput.js";
import type { StepInput } from "../../domain/StepInput.js";
import * as StepCommand from "../../domain/StepCommand.js";
import { EventApi, type OutgoingEvent } from "../EventApi.js";
import { StepIdentity } from "../StepIdentity.js";
import { StepCommandSink } from "../StepCommandSink.js";
import * as StepOperation from "./StepOperation.js";

export const sendEvent = (args: {
  readonly input: ExecutionInput;
  readonly id: StepInput;
  readonly payload: OutgoingEvent | ReadonlyArray<OutgoingEvent>;
}) =>
  Effect.gen(function* () {
    const identity = yield* StepIdentity;
    const sink = yield* StepCommandSink;
    const eventApi = yield* EventApi;
    const info = yield* identity.resolve(args.id);
    const memo = StepOperation.memoFor({ input: args.input, info });

    return yield* Match.value(memo).pipe(
      Match.tag("MemoData", ({ data }) => Effect.succeed(data as { readonly ids: ReadonlyArray<string> })),
      Match.tag("MemoError", () => Effect.fail(SendEventError.make({ message: "SendEvent failed", events: [] }))),
      Match.tag("MemoTimeout", () => Effect.fail(SendEventError.make({ message: "SendEvent timed out", events: [] }))),
      Match.tag("MemoInput", () => Effect.succeed({ ids: [] })),
      Match.tag("MemoNone", () =>
        Effect.gen(function* () {
          if (StepOperation.shouldPlan({ input: args.input, info })) {
            yield* sink.planCommand(StepCommand.SendEventPlanned.make({ info }));
            return { ids: [] };
          }

          const events = Arr.ensure(args.payload);
          const result = yield* eventApi.send(events);
          yield* sink.recordResult(
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
