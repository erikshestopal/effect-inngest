import * as Effect from "effect/Effect";
import * as Predicate from "effect/Predicate";
import * as Schema from "effect/Schema";
import { InngestFunction, InngestGroup, InngestEvent, Inngest } from "effect-inngest";
import { defineExample, eventCase } from "./_support.ts";

const DemoInvokeParent = InngestEvent.make(
  "examples/011-step-invoke/demo/invoke-parent",
  Schema.Struct({
    number: Schema.Number,
  }),
);

const DemoInvokeChild = InngestEvent.make(
  "examples/011-step-invoke/demo/invoke-child",
  Schema.Struct({
    value: Schema.Number,
  }),
);

const DemoInvokeChild2 = InngestEvent.make(
  "examples/011-step-invoke/demo/invoke-child-2",
  Schema.Struct({
    test: Schema.String,
  }),
);

const ChildFn = InngestFunction.make("child-square", {
  trigger: [DemoInvokeChild, DemoInvokeChild2],
});

const ParentFn = InngestFunction.make("parent-invoke", {
  trigger: DemoInvokeParent,
});

const Group = InngestGroup.make(ChildFn, ParentFn);

const HandlersLive = Group.toLayer({
  "child-square": ({ event }) =>
    Effect.succeed({
      squared:
        event.name === "examples/011-step-invoke/demo/invoke-child"
          ? event.data.value * event.data.value
          : event.data.test.length,
    }),
  "parent-invoke": ({ event }) =>
    Effect.gen(function* () {
      const childResult = yield* Inngest.invoke("call-child", {
        function: ChildFn,
        data: DemoInvokeChild.make({ value: event.data.number }),
      });
      return { result: Predicate.hasProperty(childResult, "squared") ? childResult.squared : null };
    }),
});

export default defineExample({
  id: "011-step-invoke",
  group: Group,
  handlers: HandlersLive,
  cases: [
    eventCase({
      events: [
        {
          name: "examples/011-step-invoke/demo/invoke-parent",
          data: {
            number: 7,
          },
        },
      ],
      expect: [
        {
          spans: ["call-child"],
          functionTag: "parent-invoke",
        },
      ],
      timeoutMs: 30000,
    }),
  ],
});
