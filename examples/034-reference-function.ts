import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { InngestFunction, InngestGroup } from "effect-inngest";
import { defineExample, eventCase } from "./_support.ts";

class DemoReferenceInvoke extends Schema.TaggedClass<DemoReferenceInvoke>()("demo/reference-invoke", {}) {}

class DemoHelperEvent extends Schema.TaggedClass<DemoHelperEvent>()("demo/helper-event", {
  input: Schema.Number,
}) {}

const HelperFn = InngestFunction.make("helper-function", {
  trigger: { event: DemoHelperEvent },
  success: Schema.Struct({ doubled: Schema.Number }),
});

const InvokerFn = InngestFunction.make("invoke-by-reference", {
  trigger: { event: DemoReferenceInvoke },
  success: Schema.Struct({ result: Schema.Number }),
});

const Group = InngestGroup.make(HelperFn, InvokerFn);

const HandlersLive = Group.toLayer({
  "helper-function": ({ event }) => Effect.succeed({ doubled: event.input * 2 }),
  "invoke-by-reference": ({ step }) =>
    Effect.gen(function* () {
      const helperResult = yield* step.invoke("call-helper", {
        function: HelperFn,
        data: { input: 21 } as never,
      });
      return { result: helperResult.doubled };
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
          name: "demo/reference-invoke",
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
