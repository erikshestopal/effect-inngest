import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { InngestFunction, InngestGroup } from "effect-inngest";
import { NonRetriableError } from "effect-inngest";
import { defineExample, eventCase } from "./_support.ts";

class DemoNonRetriable extends Schema.TaggedClass<DemoNonRetriable>()("demo/non-retriable", {}) {}

const NonRetriableFn = InngestFunction.make("non-retriable", {
  trigger: { event: DemoNonRetriable },
  success: Schema.Struct({ success: Schema.Boolean }),
});

const Group = InngestGroup.make(NonRetriableFn);

const HandlersLive = Group.toLayer({
  "non-retriable": ({ step }) => step.run("fail", Effect.fail(new NonRetriableError({ message: "No retry" }))),
});

export default defineExample({
  id: "012-error-non-retriable",
  group: Group,
  handlers: HandlersLive,
  cases: [
    eventCase({
      events: [
        {
          name: "demo/non-retriable",
          data: {},
        },
      ],
      expect: [
        {
          status: "FAILED",
          spans: ["fail"],
          functionTag: "non-retriable",
        },
      ],
    }),
  ],
});
