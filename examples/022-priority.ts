import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { InngestFunction, InngestGroup, InngestEvent } from "effect-inngest";
import { defineExample, eventCase } from "./_support.ts";

const DemoPriority = InngestEvent.make(
  "examples/022-priority/demo/priority",
  Schema.Struct({
    plan: Schema.String,
  }),
);

const PriorityFn = InngestFunction.make("priority-handler", {
  trigger: { event: DemoPriority },
  priority: { run: "event.data.plan == 'enterprise' ? 100 : 0" },
  success: Schema.Struct({ processed: Schema.String }),
});

const Group = InngestGroup.make(PriorityFn);

const HandlersLive = Group.toLayer({
  "priority-handler": ({ event }) => Effect.succeed({ processed: `Processed ${event.data.plan} plan` }),
});

export default defineExample({
  id: "022-priority",
  group: Group,
  handlers: HandlersLive,
  cases: [
    eventCase({
      events: [
        {
          name: "examples/022-priority/demo/priority",
          data: {
            plan: "enterprise",
          },
        },
      ],
      expect: [
        {
          functionTag: "priority-handler",
        },
      ],
    }),
  ],
});
