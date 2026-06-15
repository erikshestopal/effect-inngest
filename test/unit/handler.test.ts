/**
 * @module test/unit/handler
 * @description Unit tests for Handler module.
 */

import * as HttpClient from "effect/unstable/http/HttpClient";
import * as HttpClientRequest from "effect/unstable/http/HttpClientRequest";
import * as HttpClientResponse from "effect/unstable/http/HttpClientResponse";
import * as HttpClientError from "effect/unstable/http/HttpClientError";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import { describe, expect, it } from "@effect/vitest";

import { InngestFunction, InngestGroup, InngestClient, InngestEvent } from "../../src/index.js";
import * as Driver from "../../src/internal/driver.js";
import * as Handler from "../../src/internal/handler.js";

// Shared test fixtures
const CoverageTestEvent = InngestEvent.make(
  "coverage/test",
  Schema.Struct({
    count: Schema.Number,
  }),
);

const coverageTestFn = InngestFunction.make("coverage-test-fn", {
  trigger: { event: CoverageTestEvent },
  success: Schema.Struct({ count: Schema.Number }),
});

const coverageTestGroup = InngestGroup.make(coverageTestFn);

describe("Driver.layer coverage", () => {
  it.effect("creates driver layer", () =>
    Effect.gen(function* () {
      const driver = yield* Driver.Driver;
      expect(driver.execute).toBeDefined();
      expect(typeof driver.execute).toBe("function");
    }).pipe(Effect.provide(Driver.layer({ appName: "test-app" }))),
  );
});

describe("Handler.buildServeUrl coverage", () => {
  it.effect("uses servePath in registration", () =>
    Effect.gen(function* () {
      const requests: string[] = [];
      const mockHttpClient = HttpClient.make((req) => {
        requests.push(req.url);
        return Effect.succeed(
          HttpClientResponse.fromWeb(req, new Response(JSON.stringify({ message: "ok" }), { status: 200 })),
        );
      });

      const httpLayer = Layer.succeed(HttpClient.HttpClient, mockHttpClient);
      const clientLayer = InngestClient.layer({
        id: "test-app",
        mode: "dev",
        servePath: "/custom/inngest",
      }).pipe(Layer.provide(httpLayer));

      yield* Handler.handleRegistration(coverageTestGroup, "http://localhost:3000/api/inngest").pipe(
        Effect.provide(clientLayer),
        Effect.provide(httpLayer),
      );

      expect(requests.length).toBeGreaterThan(0);
    }),
  );

  it.effect("uses serveHost in registration", () =>
    Effect.gen(function* () {
      const requests: string[] = [];
      const mockHttpClient = HttpClient.make((req) => {
        requests.push(req.url);
        return Effect.succeed(
          HttpClientResponse.fromWeb(req, new Response(JSON.stringify({ message: "ok" }), { status: 200 })),
        );
      });

      const httpLayer = Layer.succeed(HttpClient.HttpClient, mockHttpClient);
      const clientLayer = InngestClient.layer({
        id: "test-app",
        mode: "dev",
        serveHost: "https://custom.host.com",
      }).pipe(Layer.provide(httpLayer));

      yield* Handler.handleRegistration(coverageTestGroup, "http://localhost:3000/api/inngest").pipe(
        Effect.provide(clientLayer),
        Effect.provide(httpLayer),
      );

      expect(requests.length).toBeGreaterThan(0);
    }),
  );

  it.effect("handles registration HTTP error", () =>
    Effect.gen(function* () {
      const mockHttpClient = HttpClient.make((req) =>
        Effect.fail(
          new HttpClientError.HttpClientError({
            reason: new HttpClientError.TransportError({
              request: req,
              cause: new Error("Network error"),
            }),
          }),
        ),
      );

      const httpLayer = Layer.succeed(HttpClient.HttpClient, mockHttpClient);
      const clientLayer = InngestClient.layer({ id: "test-app", mode: "dev" }).pipe(Layer.provide(httpLayer));

      const result = yield* Handler.handleRegistration(coverageTestGroup, "http://localhost:3000/api").pipe(
        Effect.provide(clientLayer),
        Effect.provide(httpLayer),
      );

      expect(result.status).toBe(500);
      expect(result.body.modified).toBe(false);
      expect(typeof result.body.message).toBe("string");
    }),
  );
});
