import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { InngestFunction, InngestGroup, InngestEvent, Inngest } from "effect-inngest";
import { defineExample, eventCase } from "./_support.ts";

const DemoWaitStart = InngestEvent.make("examples/058-schema-waitForEvent/demo/wait-start", Schema.Struct({}));

const DemoPageReady = InngestEvent.make(
  "examples/058-schema-waitForEvent/demo/page-ready",
  Schema.Struct({
    url: Schema.URL,
  }),
);

const SchemaWaitForEventFn = InngestFunction.make("schema-waitForEvent-demo", {
  trigger: { event: DemoWaitStart },
});

const Group = InngestGroup.make(SchemaWaitForEventFn);

const HandlersLive = Group.toLayer({
  "schema-waitForEvent-demo": () =>
    Effect.gen(function* () {
      const page = yield* Inngest.waitForEvent("wait-for-page", DemoPageReady, {
        timeout: Duration.minutes(5),
      });

      return { pathname: Option.isSome(page) ? page.value.data.url.pathname : null };
    }),
});

export default defineExample({
  id: "058-schema-waitForEvent",
  group: Group,
  handlers: HandlersLive,
  cases: [
    eventCase({
      events: [
        {
          name: "examples/058-schema-waitForEvent/demo/wait-start",
          data: {},
        },
      ],
      afterEvents: [
        {
          delayMs: 1000,
          events: [
            {
              name: "examples/058-schema-waitForEvent/demo/page-ready",
              data: { url: "https://example.com/wait" },
            },
          ],
        },
      ],
      expect: [
        {
          spans: ["wait-for-page"],
          functionTag: "schema-waitForEvent-demo",
        },
      ],
      timeoutMs: 30000,
    }),
  ],
});
