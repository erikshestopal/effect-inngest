/**
 * @module test/unit/client
 * @description Unit tests for InngestClient module.
 */

import * as Http from "node:http";
import * as FetchHttpClient from "effect/http/FetchHttpClient";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientRequest from "effect/http/HttpClientRequest";
import * as HttpClientResponse from "effect/http/HttpClientResponse";
import * as HttpClientError from "effect/http/HttpClientError";
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
          id: Config.String("TEST_APP_ID"),
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

    const resolveFromEnv = (env: Record<string, string>) =>
      Effect.runPromise(
        Effect.gen(function* () {
          const client = yield* InngestClient.InngestClient;
          return {
            mode: client.mode,
            apiBaseUrl: client.apiBaseUrl,
            eventBaseUrl: client.eventBaseUrl,
            env: client.config.env,
          };
        }).pipe(
          Effect.provide(InngestClient.layerFromEnv),
          Effect.provide(FetchHttpClient.layer),
          Effect.provide(ConfigProvider.layer(ConfigProvider.fromEnv({ env }))),
        ),
      );

    it("targets Inngest Cloud when INNGEST_DEV is unset", async () => {
      expect(await resolveFromEnv({ INNGEST_ENV: "pr-561" })).toEqual({
        mode: "cloud",
        apiBaseUrl: "https://api.inngest.com/",
        eventBaseUrl: "https://inn.gs/",
        env: "pr-561",
      });
    });

    it("targets the local dev server when INNGEST_DEV is 1", async () => {
      expect(await resolveFromEnv({ INNGEST_DEV: "1" })).toEqual({
        mode: "dev",
        apiBaseUrl: "http://localhost:8288/",
        eventBaseUrl: "http://localhost:8288/",
        env: undefined,
      });
    });

    it("targets Inngest Cloud when INNGEST_DEV is false", async () => {
      expect((await resolveFromEnv({ INNGEST_DEV: "false" })).mode).toBe("cloud");
    });

    it("targets the dev server at INNGEST_DEV when it is a URL", async () => {
      expect(await resolveFromEnv({ INNGEST_DEV: "http://inngest:8288" })).toEqual({
        mode: "dev",
        apiBaseUrl: "http://inngest:8288/",
        eventBaseUrl: "http://inngest:8288/",
        env: undefined,
      });
    });
  });

  describe("sendEvent", () => {
    const inngestEventApi = (status: number, body: string) =>
      Effect.acquireRelease(
        Effect.promise(async () => {
          const server = Http.createServer((_req, res) => {
            res.writeHead(status, { "Content-Type": "application/json" }).end(body);
          });
          await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
          const address = server.address();
          return { server, url: `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}/` };
        }),
        ({ server }) => Effect.promise(() => new Promise<void>((resolve) => server.close(() => resolve()))),
      );

    const sendThrough = (eventBaseUrl: string) =>
      Effect.gen(function* () {
        const client = yield* InngestClient.InngestClient;
        return yield* client.sendEvent([{ name: "test/event", data: {} }]);
      }).pipe(
        Effect.provide(
          InngestClient.layer({ id: "test-app", eventKey: "test-key", mode: "cloud", eventBaseUrl }).pipe(
            Layer.provide(FetchHttpClient.layer),
          ),
        ),
        Effect.flip,
      );

    for (const [status, body, message] of [
      [
        401,
        '{ "ids": [], "status": 401, "error": "Event key not found" }',
        "Failed to send events: StatusCodeError 401: Event key not found",
      ],
      [401, '{ "error": "boom" }', "Failed to send events: StatusCodeError 401: boom"],
      [
        500,
        '{ "ids": [], "status": 401, "error": "Event key not found" }',
        "Failed to send events: StatusCodeError 500: Event key not found",
      ],
      [500, '{ "error": "boom" }', "Failed to send events: StatusCodeError 500: boom"],
      [502, "<html>Bad Gateway</html>", "Failed to send events: StatusCodeError 502"],
    ] as const) {
      it.effect(`fails with the HTTP status on a ${status} answering ${body}`, () =>
        Effect.gen(function* () {
          const api = yield* inngestEventApi(status, body);

          const error = yield* sendThrough(api.url);

          expect(error.message).toBe(message);
          expect(error).toMatchObject({ _tag: "SendEventError", status, events: ["test/event"] });
        }),
      );
    }

    it.effect("fails without the URL when the event API is unreachable", () =>
      Effect.gen(function* () {
        const { url } = yield* Effect.scoped(inngestEventApi(200, "{}"));

        const error = yield* sendThrough(url);

        expect(error.message).toBe("Failed to send events: TransportError");
        expect(error).toMatchObject({ _tag: "SendEventError", status: undefined, events: ["test/event"] });
      }),
    );

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
