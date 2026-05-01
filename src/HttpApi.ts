/**
 * @since 0.1.0
 */
import * as HttpApi from "effect/unstable/httpapi/HttpApi";
import * as HttpApiBuilder from "effect/unstable/httpapi/HttpApiBuilder";
import * as HttpApiEndpoint from "effect/unstable/httpapi/HttpApiEndpoint";
import * as HttpApiGroup from "effect/unstable/httpapi/HttpApiGroup";
import * as HttpClient from "effect/unstable/http/HttpClient";
import * as HttpServerRequest from "effect/unstable/http/HttpServerRequest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { InngestClient } from "./Client.js";
import type { InngestGroup } from "./Group.js";
import * as InternalHandler from "./internal/handler.js";
import * as Protocol from "./internal/protocol.js";
import { SignatureLive } from "./internal/signature.js";

const ExecuteParams = Schema.Struct({
  fnId: Schema.String,
  stepId: Schema.optional(Schema.String),
});

class FunctionNotFoundError extends Schema.TaggedErrorClass<FunctionNotFoundError>()("FunctionNotFoundError", {
  message: Schema.String,
}) {}

const CommonErrors = [FunctionNotFoundError, InternalHandler.InvalidRequestError, InternalHandler.SignatureError];

const IntrospectEndpoint = HttpApiEndpoint.get("introspect", "/", {
  success: Protocol.IntrospectionResponse,
  error: CommonErrors,
});
const RegisterEndpoint = HttpApiEndpoint.put("register", "/", {
  success: Protocol.RegisterResponse,
  error: CommonErrors,
});
const ExecuteEndpoint = HttpApiEndpoint.post("execute", "/", {
  query: ExecuteParams,
  success: Schema.Unknown,
  error: CommonErrors,
});

/**
 * @since 0.1.0
 * @category api
 */
export class InngestApiGroup extends HttpApiGroup.make("inngest")
  .add(IntrospectEndpoint)
  .add(RegisterEndpoint)
  .add(ExecuteEndpoint) {}

type InngestApiGroupType = typeof InngestApiGroup;

/**
 * @since 0.1.0
 * @category layers
 */
export const layerGroup = <ApiId extends string, Groups extends HttpApiGroup.Any>(
  api: HttpApi.HttpApi<ApiId, Groups>,
  group: InngestGroup.Any,
): Layer.Layer<HttpApiGroup.ApiGroup<ApiId, "inngest">, never, InngestClient | HttpClient.HttpClient> => {
  const toUrl = (req: HttpServerRequest.HttpServerRequest) =>
    Option.match(HttpServerRequest.toURL(req), {
      onNone: () => req.url,
      onSome: (url) => url.toString(),
    });

  return HttpApiBuilder.group(
    api as unknown as HttpApi.HttpApi<ApiId, InngestApiGroupType>,
    "inngest",
    Effect.fn(function* (handlers) {
      return handlers
        .handle("introspect", ({ request }) =>
          InternalHandler.handleIntrospection(group, toUrl(request)).pipe(Effect.map((r) => r.body)),
        )
        .handle("register", ({ request }) =>
          InternalHandler.handleRegistration(group, toUrl(request)).pipe(Effect.map((r) => r.body)),
        )
        .handleRaw("execute", ({ query, request }) =>
          InternalHandler.verifyAndParseRequestBody(request).pipe(
            Effect.flatMap((payload) => InternalHandler.handleExecution(group, query.fnId, query.stepId, payload)),
            Effect.map((r) => r.body),
          ),
        );
    }),
  ).pipe(Layer.provide(SignatureLive)) as unknown as Layer.Layer<
    HttpApiGroup.ApiGroup<ApiId, "inngest">,
    never,
    InngestClient | HttpClient.HttpClient
  >;
};
