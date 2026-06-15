import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { InngestEvent, InngestEvents, InngestFunction, InngestGroup } from "effect-inngest";
import { defineExample, eventCase } from "./_support.ts";

const DemoTriggerFailure = InngestEvent.make(
  "demo/trigger-failure",
  Schema.Struct({
    shouldFail: Schema.Boolean,
  }),
);

class IntentionalFailure extends Schema.TaggedErrorClass<IntentionalFailure>()("IntentionalFailure", {
  message: Schema.String,
}) {}

const TriggerFailure = InngestFunction.make("trigger-failure", {
  trigger: { event: DemoTriggerFailure },
  success: Schema.Void,
  retries: 0,
});

const HandleFailure = InngestFunction.make("handle-failure", {
  trigger: { event: InngestEvents.FunctionFailed },
  success: Schema.Struct({ handled: Schema.Boolean, failedFunctionId: Schema.String }),
});

const TrackCompletion = InngestFunction.make("track-completion", {
  trigger: { event: InngestEvents.FunctionFinishedSuccess },
  success: Schema.Struct({ tracked: Schema.Boolean }),
});

const HandleCancellation = InngestFunction.make("handle-cancellation", {
  trigger: { event: InngestEvents.FunctionCancelled },
  success: Schema.Struct({ cleanedUp: Schema.Boolean }),
});

const Group = InngestGroup.make(TriggerFailure, HandleFailure, TrackCompletion, HandleCancellation);

const HandlersLive = Group.toLayer({
  "trigger-failure": ({ event }) =>
    Effect.gen(function* () {
      if (event.data.shouldFail) {
        return yield* new IntentionalFailure({ message: "Intentional failure for testing" });
      }
    }),

  "handle-failure": ({ event }) =>
    Effect.gen(function* () {
      yield* Effect.log(`Function ${event.data.function_id} failed with error: ${event.data.error.message}`);
      yield* Effect.log(`Original event: ${JSON.stringify(event.data.event)}`);
      return { handled: true, failedFunctionId: event.data.function_id };
    }),

  "track-completion": ({ event }) =>
    Effect.gen(function* () {
      yield* Effect.log(`Function ${event.data.function_id} completed successfully`);
      yield* Effect.log(`Result: ${JSON.stringify(event.data.result)}`);
      return { tracked: true };
    }),

  "handle-cancellation": ({ event }) =>
    Effect.gen(function* () {
      yield* Effect.log(`Function ${event.data.function_id} was cancelled`);
      return { cleanedUp: true };
    }),
});

export default defineExample({
  id: "055-system-events",
  group: Group,
  handlers: HandlersLive,
  cases: [
    eventCase({
      events: [
        {
          name: "demo/trigger-failure",
          data: {
            shouldFail: false,
          },
        },
      ],
      expect: [
        {
          functionTag: "trigger-failure",
        },
      ],
    }),
  ],
});
