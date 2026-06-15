import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { InngestFunction, InngestGroup, InngestEvent } from "effect-inngest";
import { defineExample, eventCase } from "./_support.ts";

class IntentionalFailure extends Schema.TaggedErrorClass<IntentionalFailure>()("IntentionalFailure", {
  message: Schema.String,
}) {}

const DemoRetriesLimited = InngestEvent.make("demo/retries-limited", Schema.Struct({}));

const RetriesLimitedFn = InngestFunction.make("retries-limited", {
  trigger: { event: DemoRetriesLimited },
  success: Schema.Struct({ success: Schema.Boolean }),
  retries: 1,
});

const Group = InngestGroup.make(RetriesLimitedFn);

const HandlersLive = Group.toLayer({
  "retries-limited": ({ step }) =>
    step.run(
      "always-fail",
      Effect.gen(function* () {
        yield* Effect.log("Attempt failed - will retry");
        return yield* new IntentionalFailure({ message: "Intentional failure" });
      }),
    ),
});

export default defineExample({
  id: "013-retries-config",
  group: Group,
  handlers: HandlersLive,
  cases: [
    eventCase({
      events: [
        {
          name: "demo/retries-limited",
          data: {},
        },
      ],
      expect: [
        {
          status: "FAILED",
          spans: ["always-fail"],
          functionTag: "retries-limited",
        },
      ],
      timeoutMs: 30000,
    }),
  ],
});
