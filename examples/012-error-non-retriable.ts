import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { InngestFunction, InngestGroup, InngestEvent } from "effect-inngest";
import { NonRetriableError } from "effect-inngest";
import { defineExample, eventCase } from "./_support.ts";

const DemoNonRetriable = InngestEvent.make("examples/012-error-non-retriable/demo/non-retriable", Schema.Struct({}));

const NonRetriableFn = InngestFunction.make("non-retriable", {
  trigger: { event: DemoNonRetriable },
  success: Schema.Struct({ success: Schema.Boolean }),
});

const Group = InngestGroup.make(NonRetriableFn);

const HandlersLive = Group.toLayer({
  "non-retriable": ({ step }) =>
    step.run("fail", Effect.fail(new NonRetriableError({ message: "No retry" })), {
      schema: Schema.Struct({ success: Schema.Boolean }),
    }),
});

export default defineExample({
  id: "012-error-non-retriable",
  group: Group,
  handlers: HandlersLive,
  cases: [
    eventCase({
      events: [
        {
          name: "examples/012-error-non-retriable/demo/non-retriable",
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
