import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { InngestFunction, InngestGroup, InngestEvent, Inngest } from "effect-inngest";
import { defineExample, eventCase } from "./_support.ts";

class Page extends Schema.Class<Page>("SchemaWorkflowResultPage")({
  url: Schema.URL,
}) {}

const DemoSchemaWorkflowResult = InngestEvent.make(
  "examples/057-schema-workflow-result/demo/schema-workflow-result",
  Schema.Struct({}),
);

const SchemaWorkflowResultFn = InngestFunction.make("schema-workflow-result-demo", {
  trigger: DemoSchemaWorkflowResult,
});

const Group = InngestGroup.make(SchemaWorkflowResultFn);

const HandlersLive = Group.toLayer({
  "schema-workflow-result-demo": () =>
    Effect.gen(function* () {
      yield* Inngest.sleep("force-replay", "1 second");
      return new Page({ url: new URL("https://example.com/workflow") });
    }),
});

export default defineExample({
  id: "057-schema-workflow-result",
  group: Group,
  handlers: HandlersLive,
  cases: [
    eventCase({
      events: [
        {
          name: "examples/057-schema-workflow-result/demo/schema-workflow-result",
          data: {},
        },
      ],
      expect: [
        {
          spans: ["force-replay"],
          functionTag: "schema-workflow-result-demo",
        },
      ],
      timeoutMs: 20000,
    }),
  ],
});
