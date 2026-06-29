/**
 * @module test/unit/client
 * @description Unit tests for InngestClient module.
 */

import * as FetchHttpClient from "effect/unstable/http/FetchHttpClient";
import * as HttpClient from "effect/unstable/http/HttpClient";
import * as HttpClientRequest from "effect/unstable/http/HttpClientRequest";
import * as HttpClientResponse from "effect/unstable/http/HttpClientResponse";
import * as HttpClientError from "effect/unstable/http/HttpClientError";
import * as Config from "effect/Config";
import * as ConfigProvider from "effect/ConfigProvider";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as Result from "effect/Result";
import { describe, expect, it } from "@effect/vitest";

import { InngestClient } from "../../src/index.js";

describe("InngestClient coverage", () => {
  describe("layer", () => {
    it("creates client layer", async () => {
      const layer = InngestClient.layer({ id: "test-app", mode: "dev" }).pipe(Layer.provide(FetchHttpClient.layer));

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const client = yield* InngestClient.InngestClient;
          return client.config.id;
        }).pipe(Effect.provide(layer)),
      );

      expect(result).toBe("test-app");
    });
  });

  describe("layerConfig", () => {
    it("creates layer from Config", async () => {
      const configProvider = ConfigProvider.fromEnv({ env: { TEST_APP_ID: "config-app" } });

      const layer = InngestClient.layerConfig(
        Config.all({
          id: Config.string("TEST_APP_ID"),
        }),
      ).pipe(Layer.provide(FetchHttpClient.layer));

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const client = yield* InngestClient.InngestClient;
          return client.config.id;
        }).pipe(Effect.provide(layer), Effect.provide(ConfigProvider.layer(configProvider))),
      );

      expect(result).toBe("config-app");
    });
  });

  describe("layerFromEnv", () => {
    it("creates layer from environment", async () => {
      const configProvider = ConfigProvider.fromEnv({ env: { INNGEST_APP_ID: "env-app" } });

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const client = yield* InngestClient.InngestClient;
          return client.config.id;
        }).pipe(
          Effect.provide(InngestClient.layerFromEnv),
          Effect.provide(FetchHttpClient.layer),
          Effect.provide(ConfigProvider.layer(configProvider)),
        ),
      );

      expect(result).toBe("env-app");
    });
  });

  describe("sendEvent", () => {
    it.effect("sends events successfully", () =>
      Effect.gen(function* () {
        const mockHttpClient = HttpClient.make((req) =>
          Effect.succeed(
            HttpClientResponse.fromWeb(
              req,
              new Response(JSON.stringify({ ids: ["evt-1"] }), {
                status: 200,
                headers: { "Content-Type": "application/json" },
              }),
            ),
          ),
        );

        const layer = InngestClient.layer({ id: "test-app", eventKey: "test-key", mode: "dev" }).pipe(
          Layer.provide(Layer.succeed(HttpClient.HttpClient, mockHttpClient)),
        );

        const result = yield* Effect.gen(function* () {
          const client = yield* InngestClient.InngestClient;
          return yield* client.sendEvent([{ name: "test/event", data: { userId: "u1" } }]);
        }).pipe(Effect.provide(layer));

        expect(result.ids).toEqual(["evt-1"]);
      }),
    );

    it.effect("uses the local dev fallback key when event key is blank", () =>
      Effect.gen(function* () {
        const requestedUrls: Array<string> = [];
        const mockHttpClient = HttpClient.make((req) => {
          requestedUrls.push(req.url);

          return Effect.succeed(
            HttpClientResponse.fromWeb(
              req,
              new Response(JSON.stringify({ ids: ["evt-1"], status: 200 }), {
                status: 200,
                headers: { "Content-Type": "text/plain; charset=utf-8" },
              }),
            ),
          );
        });

        const layer = InngestClient.layer({ id: "test-app", eventKey: "", mode: "dev" }).pipe(
          Layer.provide(Layer.succeed(HttpClient.HttpClient, mockHttpClient)),
        );

        const result = yield* Effect.gen(function* () {
          const client = yield* InngestClient.InngestClient;
          return yield* client.sendEvent([{ name: "test/event", data: { userId: "u1" } }]);
        }).pipe(Effect.provide(layer));

        expect(result.ids).toEqual(["evt-1"]);
        expect(requestedUrls).toEqual(["http://localhost:8288/e/NO_EVENT_KEY_SET"]);
      }),
    );

    it("fails without event key in cloud mode", async () => {
      const mockHttpClient = HttpClient.make((req) =>
        Effect.succeed(HttpClientResponse.fromWeb(req, new Response("{}", { status: 200 }))),
      );

      const layer = InngestClient.layer({ id: "test-app", mode: "cloud" }).pipe(
        Layer.provide(Layer.succeed(HttpClient.HttpClient, mockHttpClient)),
      );

      const exit = await Effect.runPromiseExit(
        Effect.gen(function* () {
          const client = yield* InngestClient.InngestClient;
          return yield* client.sendEvent([{ name: "test/event", data: {} }]);
        }).pipe(Effect.provide(layer)),
      );

      expect(Exit.isFailure(exit)).toBe(true);
    });

    it.effect("handles HTTP error in sendEvent", () =>
      Effect.gen(function* () {
        // Mock HttpClient that fails with a transport error
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

        const layer = InngestClient.layer({ id: "test-app", eventKey: "test-key", mode: "dev" }).pipe(
          Layer.provide(Layer.succeed(HttpClient.HttpClient, mockHttpClient)),
        );

        const result = yield* Effect.gen(function* () {
          const client = yield* InngestClient.InngestClient;
          return yield* client.sendEvent([{ name: "test/event", data: {} }]);
        }).pipe(Effect.provide(layer), Effect.result);

        expect(Result.isFailure(result)).toBe(true);
        if (Result.isFailure(result)) {
          expect(result.failure._tag).toBe("SendEventError");
        }
      }),
    );
  });
});
