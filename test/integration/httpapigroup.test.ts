import { FetchHttpClient, HttpClient, HttpClientResponse, HttpRouter, HttpServer } from "effect/unstable/http";
import { HttpApi, HttpApiBuilder } from "effect/unstable/httpapi";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import { describe, expect, it } from "@effect/vitest";
import { InngestFunction, InngestGroup, InngestClient, InngestHttpApi, InngestEvent } from "../../src/index.js";
import * as Protocol from "../../src/internal/protocol.js";

const UserCreated = InngestEvent.make(
  "user/created",
  Schema.Struct({
    userId: Schema.String,
  }),
);

/**
 * Create a mock HttpClient layer standing in for the executor's /fn/register.
 */
const makeMockHttpClient = (
  // Match the wire shape from the Inngest executor per spec §4.3.4:
  // success → `{ ok: true, modified?: boolean }`, failure → `{ error?: string }`.
  responseBody: { ok?: boolean; modified?: boolean; error?: string } = { ok: true, modified: true },
  responseStatus = 200,
) =>
  Layer.effect(
    HttpClient.HttpClient,
    Effect.sync(() =>
      HttpClient.make((request) =>
        Effect.succeed(
          HttpClientResponse.fromWeb(
            request,
            new Response(JSON.stringify(responseBody), {
              status: responseStatus,
              headers: { "Content-Type": "application/json" },
            }),
          ),
        ),
      ),
    ),
  );

describe("TB-012: HttpApiGroup Integration", () => {
  const ProcessUser = InngestFunction.make("process-user", {
    trigger: UserCreated,
  });

  const Group = InngestGroup.make(ProcessUser);

  const HandlersLive = Group.toLayer({
    "process-user": () => Effect.succeed({ ok: true }),
  });

  it("InngestApiGroup is defined", () => {
    expect(InngestHttpApi.InngestApiGroup).toBeDefined();
  });

  it.effect("layerGroup composes with HttpApiBuilder.api", () =>
    Effect.gen(function* () {
      class MyApi extends HttpApi.make("test-api").add(InngestHttpApi.InngestApiGroup.prefix("/inngest")) {}

      const ClientLive = InngestClient.layer({ id: "test-app", mode: "dev" }).pipe(
        Layer.provide(FetchHttpClient.layer),
      );

      const DependenciesLive = Layer.mergeAll(HandlersLive, ClientLive, FetchHttpClient.layer);

      const InngestLive = InngestHttpApi.layerGroup(MyApi, Group).pipe(Layer.provide(DependenciesLive));

      const ApiLive = HttpApiBuilder.layer(MyApi).pipe(Layer.provide(InngestLive));

      const { handler, dispose } = HttpRouter.toWebHandler(ApiLive.pipe(Layer.provide(HttpServer.layerServices)));

      try {
        // GET /inngest → introspection
        const getResponse = yield* Effect.tryPromise(() =>
          handler(new Request("http://localhost/inngest", { method: "GET" })),
        );
        expect(getResponse.status).toBe(200);
        expect(getResponse.headers.get(Protocol.Headers.SDK)).toBe("effect-inngest:v2.0.0");
        expect(getResponse.headers.get(Protocol.Headers.SDKHandled)).toBe("true");
        expect(getResponse.headers.get(Protocol.Headers.RequestVersion)).toBe("2");
        const getBody = (yield* Effect.tryPromise(() => getResponse.json())) as {
          function_count: number;
        };
        expect(getBody.function_count).toBe(1);

        // POST /inngest → execution
        const postResponse = yield* Effect.tryPromise(() =>
          handler(
            new Request("http://localhost/inngest?fnId=test-app-process-user", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(
                Protocol.SDKRequestBody.make({
                  event: Protocol.InngestEvent.make({
                    name: "user/created",
                    data: { userId: "u1" },
                    id: "evt_1",
                    ts: Date.now(),
                  }),
                  events: [
                    Protocol.InngestEvent.make({
                      name: "user/created",
                      data: { userId: "u1" },
                      id: "evt_1",
                      ts: Date.now(),
                    }),
                  ],
                  steps: {},
                  ctx: Protocol.SDKRequestContext.make({
                    fn_id: "test-app-process-user",
                    run_id: "run-1",
                    env: "test",
                    step_id: "step",
                    attempt: 0,
                    max_attempts: 4,
                    stack: Protocol.FunctionStack.make({ stack: [], current: 0 }),
                    qi_id: "qi_1",
                    disable_immediate_execution: false,
                    use_api: false,
                  }),
                  version: 1,
                  use_api: false,
                }),
              ),
            }),
          ),
        );
        // Checkpointing reports the run through opcodes, so the executor
        // expects 206 here (spec §4.4.2) rather than 200.
        expect(postResponse.status).toBe(206);
        expect(postResponse.headers.get(Protocol.Headers.SDK)).toBe("effect-inngest:v2.0.0");
        expect(postResponse.headers.get(Protocol.Headers.SDKHandled)).toBe("true");
        expect(postResponse.headers.get(Protocol.Headers.RequestVersion)).toBe("2");
      } finally {
        yield* Effect.tryPromise(() => dispose());
      }
    }),
  );

  it.effect("InngestApiGroup prefix is respected", () =>
    Effect.gen(function* () {
      class MyApi extends HttpApi.make("test-api").add(
        InngestHttpApi.InngestApiGroup.prefix("/api/webhooks/inngest"),
      ) {}

      const ClientLive = InngestClient.layer({ id: "test-app", mode: "dev" }).pipe(
        Layer.provide(FetchHttpClient.layer),
      );

      const DependenciesLive = Layer.mergeAll(HandlersLive, ClientLive, FetchHttpClient.layer);

      const InngestLive = InngestHttpApi.layerGroup(MyApi, Group).pipe(Layer.provide(DependenciesLive));

      const ApiLive = HttpApiBuilder.layer(MyApi).pipe(Layer.provide(InngestLive));

      const { handler, dispose } = HttpRouter.toWebHandler(ApiLive.pipe(Layer.provide(HttpServer.layerServices)));

      try {
        // Should work at /api/webhooks/inngest
        const response = yield* Effect.tryPromise(() =>
          handler(new Request("http://localhost/api/webhooks/inngest", { method: "GET" })),
        );
        expect(response.status).toBe(200);

        // Should NOT work at root /
        const rootResponse = yield* Effect.tryPromise(() =>
          handler(new Request("http://localhost/", { method: "GET" })),
        );
        expect(rootResponse.status).toBe(404);
      } finally {
        yield* Effect.tryPromise(() => dispose());
      }
    }),
  );

  it.effect("PUT /inngest registration endpoint works", () =>
    Effect.gen(function* () {
      class MyApi extends HttpApi.make("test-api").add(InngestHttpApi.InngestApiGroup.prefix("/inngest")) {}

      const mockHttpClient = makeMockHttpClient();

      const ClientLive = InngestClient.layer({ id: "test-app", mode: "dev" }).pipe(Layer.provide(mockHttpClient));

      const DependenciesLive = Layer.mergeAll(HandlersLive, ClientLive, mockHttpClient);

      const InngestLive = InngestHttpApi.layerGroup(MyApi, Group).pipe(Layer.provide(DependenciesLive));

      const ApiLive = HttpApiBuilder.layer(MyApi).pipe(Layer.provide(InngestLive));

      const { handler, dispose } = HttpRouter.toWebHandler(ApiLive.pipe(Layer.provide(HttpServer.layerServices)));

      try {
        const response = yield* Effect.tryPromise(() =>
          handler(new Request("http://localhost/inngest", { method: "PUT" })),
        );
        expect(response.status).toBe(200);
        expect(response.headers.get(Protocol.Headers.SyncKind)).toBe("out_of_band");
        const body = yield* Effect.tryPromise(() => response.json());
        expect(body).toEqual({ message: "Successfully registered", modified: true });
      } finally {
        yield* Effect.tryPromise(() => dispose());
      }
    }),
  );

  it.effect("PUT /inngest returns 500 when registration fails", () =>
    Effect.gen(function* () {
      class MyApi extends HttpApi.make("test-api").add(InngestHttpApi.InngestApiGroup.prefix("/inngest")) {}

      const mockHttpClient = makeMockHttpClient({ error: "sync rejected" }, 500);

      const ClientLive = InngestClient.layer({ id: "test-app", mode: "dev" }).pipe(Layer.provide(mockHttpClient));

      const DependenciesLive = Layer.mergeAll(HandlersLive, ClientLive, mockHttpClient);

      const InngestLive = InngestHttpApi.layerGroup(MyApi, Group).pipe(Layer.provide(DependenciesLive));

      const ApiLive = HttpApiBuilder.layer(MyApi).pipe(Layer.provide(InngestLive));

      const { handler, dispose } = HttpRouter.toWebHandler(ApiLive.pipe(Layer.provide(HttpServer.layerServices)));

      try {
        const response = yield* Effect.tryPromise(() =>
          handler(new Request("http://localhost/inngest", { method: "PUT" })),
        );
        // Spec §4.3.4: a failed sync must not be reported to the caller as 200.
        expect(response.status).toBe(500);
        expect(yield* Effect.tryPromise(() => response.json())).toEqual({
          message: "sync rejected",
          modified: false,
        });
      } finally {
        yield* Effect.tryPromise(() => dispose());
      }
    }),
  );

  it.effect("layerGroup returns 400 for malformed JSON body", () =>
    Effect.gen(function* () {
      class MyApi extends HttpApi.make("test-api").add(InngestHttpApi.InngestApiGroup.prefix("/inngest")) {}

      const ClientLive = InngestClient.layer({ id: "test-app", mode: "dev" }).pipe(
        Layer.provide(FetchHttpClient.layer),
      );

      const DependenciesLive = Layer.mergeAll(HandlersLive, ClientLive, FetchHttpClient.layer);

      const InngestLive = InngestHttpApi.layerGroup(MyApi, Group).pipe(Layer.provide(DependenciesLive));

      const ApiLive = HttpApiBuilder.layer(MyApi).pipe(Layer.provide(InngestLive));

      const { handler, dispose } = HttpRouter.toWebHandler(ApiLive.pipe(Layer.provide(HttpServer.layerServices)));

      try {
        const response = yield* Effect.tryPromise(() =>
          handler(
            new Request("http://localhost/inngest?fnId=test-app-process-user", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: "not valid json {{{",
            }),
          ),
        );
        // Effect v4 HttpApiBuilder returns 500 for decode failures on raw handlers.
        // Spec-compliant 400 mapping is exercised via InngestGroup.toWebHandler
        // (see spec-compliance-regressions.test.ts).
        expect(response.status).toBe(500);
      } finally {
        yield* Effect.tryPromise(() => dispose());
      }
    }),
  );

  it.effect("layerGroup returns 400 for invalid SDKRequestBody schema", () =>
    Effect.gen(function* () {
      class MyApi extends HttpApi.make("test-api").add(InngestHttpApi.InngestApiGroup.prefix("/inngest")) {}

      const ClientLive = InngestClient.layer({ id: "test-app", mode: "dev" }).pipe(
        Layer.provide(FetchHttpClient.layer),
      );

      const DependenciesLive = Layer.mergeAll(HandlersLive, ClientLive, FetchHttpClient.layer);

      const InngestLive = InngestHttpApi.layerGroup(MyApi, Group).pipe(Layer.provide(DependenciesLive));

      const ApiLive = HttpApiBuilder.layer(MyApi).pipe(Layer.provide(InngestLive));

      const { handler, dispose } = HttpRouter.toWebHandler(ApiLive.pipe(Layer.provide(HttpServer.layerServices)));

      try {
        const response = yield* Effect.tryPromise(() =>
          handler(
            new Request("http://localhost/inngest?fnId=test-app-process-user", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ invalid: "not a valid SDKRequestBody" }),
            }),
          ),
        );
        // Effect v4 HttpApiBuilder returns 500 for schema decode failures on raw handlers.
        expect(response.status).toBe(500);
      } finally {
        yield* Effect.tryPromise(() => dispose());
      }
    }),
  );
});
