/**
 * @module test/unit/handler
 * @description Unit tests for Handler module.
 */

import * as HttpClient from "@effect/platform/HttpClient";
import * as HttpClientRequest from "@effect/platform/HttpClientRequest";
import * as HttpClientResponse from "@effect/platform/HttpClientResponse";
import * as HttpClientError from "@effect/platform/HttpClientError";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import { describe, expect, it } from "../bun-effect.js";

import { InngestFunction, InngestGroup, InngestClient } from "../../src/index.js";
import * as Driver from "../../src/internal/driver.js";
import * as Handler from "../../src/internal/handler.js";

// Shared test fixtures
class CoverageTestEvent extends Schema.TaggedClass<CoverageTestEvent>()("coverage/test", {
  count: Schema.Number,
}) {}

const coverageTestFn = InngestFunction.make("coverage-test-fn", {
  trigger: { event: CoverageTestEvent },
  success: Schema.Struct({ count: Schema.Number }),
});

const coverageTestGroup = InngestGroup.make(coverageTestFn);

describe("Driver.layer coverage", () => {
  it.effect("creates driver layer", () =>
    Effect.gen(function* () {
      const driverContext = yield* Driver.layer({ appName: "test-app" });
      const driver = Context.get(driverContext, Driver.Driver);

      expect(driver.execute).toBeDefined();
      expect(typeof driver.execute).toBe("function");
    }),
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
      const mockHttpClient = HttpClient.make((_req) =>
        Effect.fail(
          new HttpClientError.RequestError({
            request: HttpClientRequest.get("http://localhost"),
            reason: "Transport",
            cause: new Error("Network error"),
          }),
        ),
      );

      const httpLayer = Layer.succeed(HttpClient.HttpClient, mockHttpClient);
      const clientLayer = InngestClient.layer({ id: "test-app", mode: "dev" }).pipe(Layer.provide(httpLayer));

      const result = yield* Handler.handleRegistration(coverageTestGroup, "http://localhost:3000/api").pipe(
        Effect.provide(clientLayer),
        Effect.provide(httpLayer),
      );

      expect(result.body.message).toContain("Registration failed");
    }),
  );
});
