import { FetchHttpClient, HttpApi, HttpApiBuilder, HttpServer } from "@effect/platform";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import { describe, expect, it } from "../bun-effect.js";
import { InngestFunction, InngestGroup, InngestClient, InngestHttpApi } from "../../src/index.js";
import * as Protocol from "../../src/internal/protocol.js";

class UserCreated extends Schema.TaggedClass<UserCreated>()("user/created", {
  userId: Schema.String,
}) {}

describe("TB-012: HttpApiGroup Integration", () => {
  const ProcessUser = InngestFunction.make("process-user", {
    trigger: { event: UserCreated },
    success: Schema.Unknown,
  });

  const Group = InngestGroup.make(ProcessUser);

  const HandlersLive = Group.toLayer({
    "process-user": () => Effect.succeed(undefined),
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

      const ApiLive = HttpApiBuilder.api(MyApi).pipe(Layer.provide(InngestLive));

      const { handler, dispose } = HttpApiBuilder.toWebHandler(Layer.mergeAll(ApiLive, HttpServer.layerContext));

      try {
        // GET /inngest → introspection
        const getResponse = yield* Effect.tryPromise(() =>
          handler(new Request("http://localhost/inngest", { method: "GET" })),
        );
        expect(getResponse.status).toBe(200);
        const getBody = (yield* Effect.tryPromise(() => getResponse.json())) as { function_count: number };
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
        expect(postResponse.status).toBe(200);
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

      const ApiLive = HttpApiBuilder.api(MyApi).pipe(Layer.provide(InngestLive));

      const { handler, dispose } = HttpApiBuilder.toWebHandler(Layer.mergeAll(ApiLive, HttpServer.layerContext));

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

      const ClientLive = InngestClient.layer({ id: "test-app", mode: "dev" }).pipe(
        Layer.provide(FetchHttpClient.layer),
      );

      const DependenciesLive = Layer.mergeAll(HandlersLive, ClientLive, FetchHttpClient.layer);

      const InngestLive = InngestHttpApi.layerGroup(MyApi, Group).pipe(Layer.provide(DependenciesLive));

      const ApiLive = HttpApiBuilder.api(MyApi).pipe(Layer.provide(InngestLive));

      const { handler, dispose } = HttpApiBuilder.toWebHandler(Layer.mergeAll(ApiLive, HttpServer.layerContext));

      try {
        const response = yield* Effect.tryPromise(() =>
          handler(new Request("http://localhost/inngest", { method: "PUT" })),
        );
        expect(response.status).toBe(200);
        const body = yield* Effect.tryPromise(() => response.json());
        expect(body).toBeDefined();
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

      const ApiLive = HttpApiBuilder.api(MyApi).pipe(Layer.provide(InngestLive));

      const { handler, dispose } = HttpApiBuilder.toWebHandler(Layer.mergeAll(ApiLive, HttpServer.layerContext));

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
        // 400 Bad Request is correct for malformed JSON input
        expect(response.status).toBe(400);
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

      const ApiLive = HttpApiBuilder.api(MyApi).pipe(Layer.provide(InngestLive));

      const { handler, dispose } = HttpApiBuilder.toWebHandler(Layer.mergeAll(ApiLive, HttpServer.layerContext));

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
        // 400 Bad Request is correct for schema validation errors
        expect(response.status).toBe(400);
      } finally {
        yield* Effect.tryPromise(() => dispose());
      }
    }),
  );
});
