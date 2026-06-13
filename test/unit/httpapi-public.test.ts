// @ts-nocheck
import * as HttpClient from "effect/unstable/http/HttpClient";
import * as HttpClientResponse from "effect/unstable/http/HttpClientResponse";
import * as HttpEffect from "effect/unstable/http/HttpEffect";
import * as HttpRouter from "effect/unstable/http/HttpRouter";
import { HttpApi, HttpApiBuilder } from "effect/unstable/httpapi";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import { describe, expect, it } from "@effect/vitest";
import { InngestClient, InngestFunction, InngestGroup, InngestHttpApi } from "../../src/index.js";

class UserCreated extends Schema.TaggedClass<UserCreated>()("user/created", {
  userId: Schema.String,
}) {}

const ProcessUser = InngestFunction.make("process-user", {
  trigger: { event: UserCreated },
  success: Schema.Struct({ received: Schema.String }),
});

const Group = InngestGroup.make(ProcessUser);

const handlersLayer = Group.toLayer({
  "process-user": ({ event }) => Effect.succeed({ received: event.userId }),
});

// Mirror the executor's wire shape for /fn/register per spec §4.3.4.
const mockHttpClient = HttpClient.make((req) =>
  Effect.succeed(
    HttpClientResponse.fromWeb(
      req,
      new Response(JSON.stringify({ ok: true, modified: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    ),
  ),
);

const httpLayer = Layer.succeed(HttpClient.HttpClient, mockHttpClient);
const clientLayer = InngestClient.layer({ id: "test-app", mode: "dev", checkpointing: false }).pipe(
  Layer.provide(httpLayer),
);
const dependencies = Layer.mergeAll(handlersLayer, clientLayer, httpLayer);

const makeExecutionRequest = () => {
  const now = Date.now();
  return new Request("http://localhost/inngest?fnId=test-app-process-user", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      event: {
        name: "user/created",
        data: { userId: "u1" },
        id: "evt_1",
        ts: now,
      },
      events: [
        {
          name: "user/created",
          data: { userId: "u1" },
          id: "evt_1",
          ts: now,
        },
      ],
      steps: {},
      ctx: {
        fn_id: "test-app-process-user",
        run_id: "run_123",
        env: "test",
        step_id: "step",
        attempt: 0,
        max_attempts: 4,
        stack: { stack: [], current: 0 },
        qi_id: "qi_123",
        disable_immediate_execution: false,
        use_api: false,
      },
      version: 1,
      use_api: false,
    }),
  });
};

describe("InngestHttpApi public surface", () => {
  it("exports the built-in API group", () => {
    expect(InngestHttpApi.InngestApiGroup).toBeDefined();
  });

  it.effect("layerGroup handles introspection, registration, and execution requests", () =>
    Effect.gen(function* () {
      const MyApi = HttpApi.make("test-api").add(InngestHttpApi.InngestApiGroup.prefix("/inngest"));

      const inngestLayer = InngestHttpApi.layerGroup(MyApi, Group).pipe(Layer.provide(dependencies));

      const app = yield* HttpRouter.toHttpEffect(HttpApiBuilder.layer(MyApi).pipe(Layer.provide(inngestLayer)));
      const handler = HttpEffect.toWebHandler(app);

      const introspection = yield* Effect.tryPromise(() =>
        handler(new Request("http://localhost/inngest", { method: "GET" })),
      );
      expect(introspection.status).toBe(200);
      expect(yield* Effect.tryPromise(() => introspection.json())).toEqual(
        expect.objectContaining({ function_count: 1, mode: "dev" }),
      );

      const registration = yield* Effect.tryPromise(() =>
        handler(new Request("http://localhost/inngest", { method: "PUT" })),
      );
      expect(registration.status).toBe(200);
      expect(yield* Effect.tryPromise(() => registration.json())).toMatchObject({
        message: "Successfully registered",
        modified: true,
      });

      const execution = yield* Effect.tryPromise(() => handler(makeExecutionRequest()));
      expect(execution.status).toBe(200);
      expect(yield* Effect.tryPromise(() => execution.json())).toEqual({ received: "u1" });
    }),
  );
});
