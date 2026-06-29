import * as Effect from "effect/Effect";
import * as Predicate from "effect/Predicate";
import * as Schema from "effect/Schema";
import { describe, expect, it } from "@effect/vitest";
import { InngestFunction, InngestGroup, InngestEvent, Inngest } from "../../src/index.js";
import * as Protocol from "../../src/internal/protocol.js";
import { makeTestLayer, makeTestRequest } from "./_helpers.js";
import { StepOpcodeResponse } from "./_schemas.js";

class Page extends Schema.Class<Page>("SchemaCodecPage")({
  url: Schema.URL,
}) {}

const PageRequested = InngestEvent.make(
  "schema/page-requested",
  Schema.Struct({
    url: Schema.URL,
  }),
);

const WorkflowStarted = InngestEvent.make("schema/workflow-started", Schema.Struct({}));

const pageJson = { url: "https://example.com/path" };

const makePage = () => new Page({ url: new URL(pageJson.url) });

describe("Schema codec boundaries", () => {
  it.effect("decodes function event data with the trigger event schema", () =>
    Effect.gen(function* () {
      const Fn = InngestFunction.make("schema-event-input", {
        trigger: { event: PageRequested },
      });
      const Group = InngestGroup.make(Fn);
      const HandlersLive = Group.toLayer({
        "schema-event-input": ({ event }) =>
          Effect.sync(() => {
            expect(event.data.url).toBeInstanceOf(URL);
            return { pathname: event.data.url.pathname };
          }),
      });
      const { handler, dispose } = InngestGroup.toWebHandler(Group, { layer: makeTestLayer(HandlersLive) });

      try {
        const response = yield* Effect.tryPromise(() =>
          handler(
            makeTestRequest({
              fnId: "schema-event-input",
              eventName: "schema/page-requested",
              eventData: pageJson,
            }),
          ),
        );

        expect(response.status).toBe(200);
        expect(yield* Effect.tryPromise(() => response.json())).toEqual({ pathname: "/path" });
      } finally {
        yield* Effect.tryPromise(() => dispose());
      }
    }),
  );

  it.effect("replays Inngest.run memo data as raw JSON", () =>
    Effect.gen(function* () {
      const Fn = InngestFunction.make("schema-step-run-classic", {
        trigger: { event: WorkflowStarted },
        checkpointing: false,
      });
      const Group = InngestGroup.make(Fn);
      const HandlersLive = Group.toLayer({
        "schema-step-run-classic": () =>
          Effect.gen(function* () {
            const page = yield* Inngest.run("make-page", Effect.succeed(makePage()));
            return {
              pathname:
                Predicate.hasProperty(page, "url") && typeof page.url === "string" ? new URL(page.url).pathname : null,
            };
          }),
      });
      const { handler, dispose } = InngestGroup.toWebHandler(Group, { layer: makeTestLayer(HandlersLive) });
      const request = (steps: (typeof Protocol.SDKRequestBody.Type)["steps"] = {}) =>
        makeTestRequest({
          fnId: "schema-step-run-classic",
          eventName: "schema/workflow-started",
          eventData: {},
          steps,
        });

      try {
        const firstResponse = yield* Effect.tryPromise(() => handler(request()));
        expect(firstResponse.status).toBe(206);
        const firstBody = yield* Effect.tryPromise(() => firstResponse.json()).pipe(
          Effect.flatMap(Schema.decodeUnknownEffect(StepOpcodeResponse)),
        );
        const stepId = firstBody[0]!.id;

        const response = yield* Effect.tryPromise(() =>
          handler(
            request({
              [stepId]: { data: pageJson },
            }),
          ),
        );

        expect(response.status).toBe(200);
        expect(yield* Effect.tryPromise(() => response.json())).toEqual({ pathname: "/path" });
      } finally {
        yield* Effect.tryPromise(() => dispose());
      }
    }),
  );
});
