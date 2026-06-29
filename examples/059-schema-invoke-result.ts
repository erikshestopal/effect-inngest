import * as Effect from "effect/Effect";
import * as Predicate from "effect/Predicate";
import * as Schema from "effect/Schema";
import { InngestFunction, InngestGroup, InngestEvent, Inngest } from "effect-inngest";
import { defineExample, eventCase } from "./_support.ts";

class Page extends Schema.Class<Page>("SchemaInvokeResultPage")({
  url: Schema.URL,
}) {}

const DemoInvokeParent = InngestEvent.make("examples/059-schema-invoke-result/demo/parent", Schema.Struct({}));
const DemoInvokeChild = InngestEvent.make("examples/059-schema-invoke-result/demo/child", Schema.Struct({}));

const ChildFn = InngestFunction.make("schema-invoke-child", {
  trigger: DemoInvokeChild,
});

const ParentFn = InngestFunction.make("schema-invoke-parent", {
  trigger: DemoInvokeParent,
});

const Group = InngestGroup.make(ChildFn, ParentFn);

const HandlersLive = Group.toLayer({
  "schema-invoke-child": () => Effect.succeed(new Page({ url: new URL("https://example.com/invoke") })),
  "schema-invoke-parent": () =>
    Effect.gen(function* () {
      const page = yield* Inngest.invoke("call-schema-child", {
        function: ChildFn,
        data: DemoInvokeChild.make({}),
      });

      return {
        pathname:
          Predicate.hasProperty(page, "url") && typeof page.url === "string" ? new URL(page.url).pathname : null,
      };
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
