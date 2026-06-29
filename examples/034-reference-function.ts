import * as Effect from "effect/Effect";
import * as Predicate from "effect/Predicate";
import * as Schema from "effect/Schema";
import { InngestFunction, InngestGroup, InngestEvent } from "effect-inngest";
import { defineExample, eventCase } from "./_support.ts";

const DemoReferenceInvoke = InngestEvent.make(
  "examples/034-reference-function/demo/reference-invoke",
  Schema.Struct({}),
);

const DemoHelperEvent = InngestEvent.make(
  "examples/034-reference-function/demo/helper-event",
  Schema.Struct({
    input: Schema.Number,
  }),
);

const HelperFn = InngestFunction.make("helper-function", {
  trigger: { event: DemoHelperEvent },
});

const InvokerFn = InngestFunction.make("invoke-by-reference", {
  trigger: { event: DemoReferenceInvoke },
});

const Group = InngestGroup.make(HelperFn, InvokerFn);

const HandlersLive = Group.toLayer({
  "helper-function": ({ event }) => Effect.succeed({ doubled: event.data.input * 2 }),
  "invoke-by-reference": ({ step }) =>
    Effect.gen(function* () {
      const helperResult = yield* step.invoke("call-helper", {
        function: HelperFn,
        data: DemoHelperEvent.make({ input: 21 }),
      });
      return { result: Predicate.hasProperty(helperResult, "doubled") ? helperResult.doubled : null };
    }),
});

export default defineExample({
  id: "034-reference-function",
  group: Group,
  handlers: HandlersLive,
  cases: [
    eventCase({
      events: [
        {
          name: "examples/034-reference-function/demo/reference-invoke",
          data: {},
        },
      ],
      expect: [
        {
          spans: ["call-helper"],
          functionTag: "invoke-by-reference",
        },
      ],
      timeoutMs: 30000,
    }),
  ],
});
