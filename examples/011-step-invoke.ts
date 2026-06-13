import * as Effect from "effect/Effect";
import * as Predicate from "effect/Predicate";
import * as Schema from "effect/Schema";
import { InngestFunction, InngestGroup } from "effect-inngest";
import { defineExample, eventCase } from "./_support.ts";

class DemoInvokeParent extends Schema.TaggedClass<DemoInvokeParent>()("demo/invoke-parent", {
  number: Schema.Number,
}) {}

class DemoInvokeChild extends Schema.TaggedClass<DemoInvokeChild>()("demo/invoke-child", {
  value: Schema.Number,
}) {}

class DemoInvokeChild2 extends Schema.TaggedClass<DemoInvokeChild2>()("demo/invoke-child-2", {
  test: Schema.String,
}) {}

const ChildFn = InngestFunction.make("child-square", {
  trigger: [{ event: DemoInvokeChild }, { event: DemoInvokeChild2 }],
  success: Schema.Struct({ squared: Schema.Number }),
});

const ParentFn = InngestFunction.make("parent-invoke", {
  trigger: { event: DemoInvokeParent },
  success: Schema.Struct({ result: Schema.Number }),
});

const Group = InngestGroup.make(ChildFn, ParentFn);

const HandlersLive = Group.toLayer({
  "child-square": ({ event }) =>
    Effect.succeed({
      squared: Predicate.hasProperty(event, "value") ? event.value * event.value : event.test.length,
    }),
  "parent-invoke": ({ event, step }) =>
    Effect.gen(function* () {
      const childResult = yield* step.invoke("call-child", {
        function: ChildFn,
        data: DemoInvokeChild.make({ value: event.number }),
      });
      return { result: childResult.squared };
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
          name: "demo/invoke-parent",
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
