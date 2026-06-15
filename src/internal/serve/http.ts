/**
 * HTTP adapter boundary for Inngest routes.
 * @internal
 */
import * as HttpClient from "effect/unstable/http/HttpClient";
import * as HttpEffect from "effect/unstable/http/HttpEffect";
import * as HttpServerRequest from "effect/unstable/http/HttpServerRequest";
import * as HttpServerResponse from "effect/unstable/http/HttpServerResponse";
import * as UrlParams from "effect/unstable/http/UrlParams";
import { Context, Effect, Layer, Option, Schema } from "effect";
import { InngestClient } from "../../Client.js";
import type { InngestGroup } from "../../Group.js";
import * as InternalHandler from "../handler.js";
import * as Protocol from "../protocol.js";
import { SignatureLive } from "../signature.js";

export class MethodNotAllowed extends Schema.TaggedErrorClass<MethodNotAllowed>()("MethodNotAllowed", {
  method: Schema.String,
}) {}

export class InvalidQueryParams extends Schema.TaggedErrorClass<InvalidQueryParams>()("InvalidQueryParams", {
  message: Schema.String,
}) {}

export const toHttpApp = Effect.fn("InngestGroup.toHttpApp")(
  function* (group: InngestGroup.Any) {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const method = request.method;
    const requestUrl = Option.match(HttpServerRequest.toURL(request), {
      onNone: () => request.url,
      onSome: (url) => url.toString(),
    });

    if (method === "GET") {
      const result = yield* InternalHandler.handleIntrospection(group, requestUrl);
      return yield* HttpServerResponse.json(result.body, {
        status: result.status,
        headers: result.headers,
      });
    }

    if (method === "PUT") {
      const result = yield* InternalHandler.handleRegistration(group, requestUrl);
      return yield* HttpServerResponse.json(result.body, {
        status: result.status,
        headers: result.headers,
      });
    }

    if (method === "POST") {
      const url = yield* Option.match(HttpServerRequest.toURL(request), {
        onNone: () =>
          Effect.fail(
            HttpServerResponse.jsonUnsafe(
              { error: "Unable to parse request URL" },
              { status: 400, headers: { [Protocol.Headers.NoRetry]: "true" } },
            ),
          ),
        onSome: (u) => Effect.succeed(u),
      });

      const ExecuteParamsSchema = UrlParams.schemaRecord.pipe(
        Schema.decodeTo(
          Schema.Struct({
            fnId: Schema.String,
            stepId: Schema.optional(Schema.String),
          }),
        ),
      );

      const params = yield* Schema.decodeUnknownEffect(ExecuteParamsSchema)(UrlParams.fromInput(url.searchParams)).pipe(
        Effect.catch(() =>
          Effect.fail(
            HttpServerResponse.jsonUnsafe(
              { error: "Missing or invalid fnId query parameter" },
              { status: 400, headers: { [Protocol.Headers.NoRetry]: "true" } },
            ),
          ),
        ),
      );

      const body = yield* InternalHandler.verifyAndParseRequestBody(request).pipe(
        Effect.provide(SignatureLive),
        Effect.catch((error) =>
          Effect.fail(
            HttpServerResponse.jsonUnsafe(
              { error: error.message },
              {
                status: error._tag === "SignatureError" ? 401 : 400,
                headers: { [Protocol.Headers.NoRetry]: "true" },
              },
            ),
          ),
        ),
      );

      const result = yield* InternalHandler.handleExecution(group, params.fnId, params.stepId, body);

      return yield* HttpServerResponse.json(result.body, {
        status: result.status,
        headers: result.headers,
      });
    }

    return yield* HttpServerResponse.json({ error: `Method ${method} not allowed` }, { status: 405 });
  },
  Effect.catchCause((cause) =>
    HttpServerResponse.json({ error: "Internal server error", cause: String(cause) }, { status: 500 }).pipe(
      Effect.orDie,
    ),
  ),
);

export const toWebHandler = <R, E>(
  group: InngestGroup.Any,
  options: {
    readonly layer: Layer.Layer<InngestClient | HttpClient.HttpClient | R, E, never>;
  },
): {
  readonly handler: (request: Request, context?: Context.Context<never>) => Promise<Response>;
  readonly dispose: () => Promise<void>;
} => HttpEffect.toWebHandlerLayer(toHttpApp(group), options.layer);
