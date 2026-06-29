import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { InngestFunction, InngestGroup, InngestEvent, Inngest } from "effect-inngest";
import { defineExample, eventCase } from "./_support.ts";

class Page extends Schema.Class<Page>("SchemaStepResultPage")({
  url: Schema.URL,
}) {}

const DemoSchemaStepResult = InngestEvent.make(
  "examples/056-schema-step-result/demo/schema-step-result",
  Schema.Struct({}),
);

const SchemaStepResultFn = InngestFunction.make("schema-step-result-demo", {
  trigger: { event: DemoSchemaStepResult },
});

const Group = InngestGroup.make(SchemaStepResultFn);

const HandlersLive = Group.toLayer({
  "schema-step-result-demo": () =>
    Effect.gen(function* () {
      const page = yield* Inngest.run(
        "load-page",
        Effect.succeed(new Page({ url: new URL("https://example.com/docs") })),
      );
      yield* Inngest.sleep("force-replay", "1 second");

      return { pathname: page.url.pathname };
    }),
});

export default defineExample({
  id: "056-schema-step-result",
  group: Group,
  handlers: HandlersLive,
  cases: [
    eventCase({
      events: [
        {
          name: "examples/056-schema-step-result/demo/schema-step-result",
          data: {},
        },
      ],
      expect: [
        {
          spans: ["load-page", "force-replay"],
          functionTag: "schema-step-result-demo",
        },
      ],
      timeoutMs: 20000,
    }),
  ],
});
