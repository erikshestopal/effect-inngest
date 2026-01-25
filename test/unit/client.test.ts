/**
 * @module test/unit/client
 * @description Unit tests for InngestClient module.
 */

import * as FetchHttpClient from "@effect/platform/FetchHttpClient";
import * as HttpClient from "@effect/platform/HttpClient";
import * as HttpClientRequest from "@effect/platform/HttpClientRequest";
import * as HttpClientResponse from "@effect/platform/HttpClientResponse";
import * as HttpClientError from "@effect/platform/HttpClientError";
import * as Config from "effect/Config";
import * as ConfigProvider from "effect/ConfigProvider";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as Either from "effect/Either";
import { describe, expect, it } from "../bun-effect.js";

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
      const configProvider = ConfigProvider.fromMap(new Map([["TEST_APP_ID", "config-app"]]));

      const layer = InngestClient.layerConfig(
        Config.all({
          id: Config.string("TEST_APP_ID"),
        }),
      ).pipe(Layer.provide(FetchHttpClient.layer));

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const client = yield* InngestClient.InngestClient;
          return client.config.id;
        }).pipe(Effect.provide(layer), Effect.withConfigProvider(configProvider)),
      );

      expect(result).toBe("config-app");
    });
  });

  describe("layerFromEnv", () => {
    it("creates layer from environment", async () => {
      const configProvider = ConfigProvider.fromMap(new Map([["INNGEST_APP_ID", "env-app"]]));

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const client = yield* InngestClient.InngestClient;
          return client.config.id;
        }).pipe(
          Effect.provide(InngestClient.layerFromEnv),
          Effect.provide(FetchHttpClient.layer),
          Effect.withConfigProvider(configProvider),
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
        // Mock HttpClient that fails
        const mockHttpClient = HttpClient.make((_req) =>
          Effect.fail(
            new HttpClientError.RequestError({
              request: HttpClientRequest.get("http://localhost"),
              reason: "Transport",
              cause: new Error("Network error"),
            }),
          ),
        );

        const layer = InngestClient.layer({ id: "test-app", eventKey: "test-key", mode: "dev" }).pipe(
          Layer.provide(Layer.succeed(HttpClient.HttpClient, mockHttpClient)),
        );

        const result = yield* Effect.gen(function* () {
          const client = yield* InngestClient.InngestClient;
          return yield* client.sendEvent([{ name: "test/event", data: {} }]);
        }).pipe(Effect.provide(layer), Effect.either);

        expect(Either.isLeft(result)).toBe(true);
        if (Either.isLeft(result)) {
          expect(result.left._tag).toBe("SendEventError");
        }
      }),
    );
  });
});
