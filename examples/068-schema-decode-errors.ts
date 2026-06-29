import { FetchHttpClient } from "effect/unstable/http";
import * as Effect from "effect/Effect";
import * as Predicate from "effect/Predicate";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import { InngestClient, InngestFunction, InngestGroup, InngestEvent, Inngest } from "effect-inngest";
import * as Protocol from "../src/internal/protocol.ts";
import { defineExample, effectCase } from "./_support.ts";

class Page extends Schema.Class<Page>("SchemaDecodeErrorPage")({
  url: Schema.URL,
}) {}

const Started = InngestEvent.make("examples/068-schema-decode-errors/started", Schema.Struct({}));
const PageReady = InngestEvent.make("examples/068-schema-decode-errors/page-ready", Schema.Struct({ url: Schema.URL }));
const ChildInput = InngestEvent.make("examples/068-schema-decode-errors/child", Schema.Struct({}));

const StepRunFn = InngestFunction.make("schema-step-run-decode-error", {
  trigger: Started,
  checkpointing: false,
});

const WaitForEventFn = InngestFunction.make("schema-waitForEvent-decode-error", {
  trigger: Started,
  checkpointing: false,
});

const ChildFn = InngestFunction.make("schema-invoke-decode-error-child", {
  trigger: ChildInput,
  checkpointing: false,
});

const InvokeFn = InngestFunction.make("schema-invoke-decode-error", {
  trigger: Started,
  checkpointing: false,
});

const Group = InngestGroup.make(StepRunFn, WaitForEventFn, ChildFn, InvokeFn);

const HandlersLive = Group.toLayer({
  "schema-step-run-decode-error": () =>
    Effect.gen(function* () {
      const page = yield* Inngest.run(
        "load-invalid-page",
        Effect.succeed(new Page({ url: new URL("https://example.com/valid") })),
      );
      return { pathname: page.url.pathname };
    }),
  "schema-waitForEvent-decode-error": () =>
    Effect.gen(function* () {
      const page = yield* Inngest.waitForEvent("wait-invalid-page", PageReady, { timeout: "5 minutes" });
      if (page._tag === "None") return { pathname: "none" };
      return { pathname: page.value.data.url.pathname };
    }),
  "schema-invoke-decode-error-child": () => Effect.succeed(new Page({ url: new URL("https://example.com/valid") })),
  "schema-invoke-decode-error": () =>
    Effect.gen(function* () {
      const page = yield* Inngest.invoke("invoke-invalid-page", { function: ChildFn, data: ChildInput.make({}) });
      return {
        pathname:
          Predicate.hasProperty(page, "url") && typeof page.url === "string" ? new URL(page.url).pathname : null,
      };
    }),
});

const ClientLive = InngestClient.layer({
  id: "examples-068-schema-decode-errors",
  eventKey: "test-key",
  mode: "dev",
  checkpointing: false,
}).pipe(Layer.provide(FetchHttpClient.layer));

const layer = Layer.mergeAll(HandlersLive, ClientLive, FetchHttpClient.layer);

const request = (args: { readonly fnId: string; readonly steps?: (typeof Protocol.SDKRequestBody.Type)["steps"] }) =>
  new Request(
    `http://localhost/examples/068-schema-decode-errors?fnId=examples-068-schema-decode-errors-${args.fnId}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(
        Protocol.SDKRequestBody.make({
          event: Protocol.InngestEvent.make({
            name: Started.identifier,
            data: {},
            id: "evt_1",
            ts: 1,
          }),
          events: [],
          steps: args.steps ?? {},
          ctx: Protocol.SDKRequestContext.make({
            fn_id: `examples-068-schema-decode-errors-${args.fnId}`,
            run_id: "run_1",
            env: "test",
            step_id: "step",
            attempt: 0,
            max_attempts: 1,
            stack: Protocol.FunctionStack.make({ stack: [], current: 0 }),
            qi_id: "qi_1",
            disable_immediate_execution: true,
            use_api: false,
          }),
          version: 1,
          use_api: false,
        }),
      ),
    },
  );

const firstOpcodeId = (body: unknown): string => {
  if (!Array.isArray(body) || typeof body[0]?.id !== "string") {
    throw new Error(`Expected first opcode id, got ${JSON.stringify(body)}`);
  }
  return body[0].id;
};

const assertDecodeFailure = async (response: Response) => {
  if (response.status !== 400) {
    throw new Error(`Expected schema decode failure status 400, got ${response.status}: ${await response.text()}`);
  }
  if (response.headers.get(Protocol.Headers.NoRetry) !== "true") {
    throw new Error("Expected schema decode failure to set x-inngest-no-retry: true");
  }

  const body = (await response.json()) as { readonly name?: string; readonly message?: string };
  if (body.name !== "StepError") {
    throw new Error(`Expected schema decode failure body to be StepError, got ${JSON.stringify(body)}`);
  }
  if (!body.message?.includes("not-a-url")) {
    throw new Error(`Expected schema decode failure message to mention invalid URL, got ${JSON.stringify(body)}`);
  }
};

const replayWithBadMemo = (fnId: string, memoData: unknown) =>
  Effect.gen(function* () {
    const { handler, dispose } = InngestGroup.toWebHandler(Group, { layer });
    try {
      const planned = yield* Effect.promise(() => handler(request({ fnId })));
      const plannedBody = yield* Effect.promise(() => planned.json());
      const stepId = firstOpcodeId(plannedBody);
      const failed = yield* Effect.promise(() => handler(request({ fnId, steps: { [stepId]: { data: memoData } } })));
      yield* Effect.promise(() => assertDecodeFailure(failed));
    } finally {
      yield* Effect.promise(() => dispose());
    }
  });

const main = Effect.gen(function* () {
  yield* replayWithBadMemo("schema-step-run-decode-error", { url: "not-a-url" });
  yield* replayWithBadMemo("schema-waitForEvent-decode-error", {
    name: PageReady.identifier,
    data: { url: "not-a-url" },
    id: "evt_page",
    ts: 1,
  });
  yield* replayWithBadMemo("schema-invoke-decode-error", { url: "not-a-url" });
});

export default defineExample({
  id: "068-schema-decode-errors",
  cases: [effectCase(main, { timeoutMs: 20_000 })],
});
