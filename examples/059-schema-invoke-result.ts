import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { InngestFunction, InngestGroup, InngestEvent } from "effect-inngest";
import { defineExample, eventCase } from "./_support.ts";

class Page extends Schema.Class<Page>("SchemaInvokeResultPage")({
  url: Schema.URL,
}) {}

const DemoInvokeParent = InngestEvent.make("examples/059-schema-invoke-result/demo/parent", Schema.Struct({}));
const DemoInvokeChild = InngestEvent.make("examples/059-schema-invoke-result/demo/child", Schema.Struct({}));

const ChildFn = InngestFunction.make("schema-invoke-child", {
  trigger: { event: DemoInvokeChild },
  success: Page,
});

const ParentFn = InngestFunction.make("schema-invoke-parent", {
  trigger: { event: DemoInvokeParent },
  success: Schema.Struct({ pathname: Schema.String }),
});

const Group = InngestGroup.make(ChildFn, ParentFn);

const HandlersLive = Group.toLayer({
  "schema-invoke-child": () => Effect.succeed(new Page({ url: new URL("https://example.com/invoke") })),
  "schema-invoke-parent": ({ step }) =>
    Effect.gen(function* () {
      const page = yield* step.invoke("call-schema-child", {
        function: ChildFn,
        data: DemoInvokeChild.make({}),
      });

      return { pathname: page.url.pathname };
    }),
});

export default defineExample({
  id: "059-schema-invoke-result",
  group: Group,
  handlers: HandlersLive,
  cases: [
    eventCase({
      events: [
        {
          name: "examples/059-schema-invoke-result/demo/parent",
          data: {},
        },
      ],
      expect: [
        {
          spans: ["call-schema-child"],
          functionTag: "schema-invoke-parent",
        },
      ],
      timeoutMs: 30000,
    }),
  ],
});
