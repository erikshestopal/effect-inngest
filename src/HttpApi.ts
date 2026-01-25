/**
 * @since 0.1.0
 */
import * as HttpApi from "@effect/platform/HttpApi";
import * as HttpApiBuilder from "@effect/platform/HttpApiBuilder";
import * as HttpApiEndpoint from "@effect/platform/HttpApiEndpoint";
import * as HttpApiGroup from "@effect/platform/HttpApiGroup";
import * as HttpClient from "@effect/platform/HttpClient";
import * as HttpServerRequest from "@effect/platform/HttpServerRequest";
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

class FunctionNotFoundError extends Schema.TaggedError<FunctionNotFoundError>()("FunctionNotFoundError", {
  message: Schema.String,
}) {}

const IntrospectEndpoint = HttpApiEndpoint.get("introspect", "/").addSuccess(Protocol.IntrospectionResponse);
const RegisterEndpoint = HttpApiEndpoint.put("register", "/").addSuccess(Protocol.RegisterResponse);
const ExecuteEndpoint = HttpApiEndpoint.post("execute", "/").setUrlParams(ExecuteParams).addSuccess(Schema.Unknown);

/**
 * @since 0.1.0
 * @category api
 */
export const InngestApiGroup = HttpApiGroup.make("inngest")
  .add(IntrospectEndpoint)
  .add(RegisterEndpoint)
  .add(ExecuteEndpoint)
  .addError(FunctionNotFoundError, { status: 404 })
  .addError(InternalHandler.InvalidRequestError, { status: 400 })
  .addError(InternalHandler.SignatureError, { status: 401 });

type InngestApiGroupType = typeof InngestApiGroup;

/**
 * @since 0.1.0
 * @category layers
 */
export const layerGroup = <ApiId extends string, Groups extends HttpApiGroup.HttpApiGroup.Any, ApiError, ApiR>(
  api: HttpApi.HttpApi<ApiId, Groups, ApiError, ApiR>,
  group: InngestGroup.Any,
): Layer.Layer<HttpApiGroup.ApiGroup<ApiId, "inngest">, never, InngestClient | HttpClient.HttpClient> => {
  const toUrl = (req: HttpServerRequest.HttpServerRequest) =>
    Option.match(HttpServerRequest.toURL(req), {
      onNone: () => req.url,
      onSome: (url) => url.toString(),
    });

  return HttpApiBuilder.group(
    api as unknown as HttpApi.HttpApi<ApiId, InngestApiGroupType, ApiError, ApiR>,
    "inngest",
    (handlers) =>
      handlers
        .handle("introspect", ({ request }) =>
          InternalHandler.handleIntrospection(group, toUrl(request)).pipe(Effect.map((r) => r.body)),
        )
        .handle("register", ({ request }) =>
          InternalHandler.handleRegistration(group, toUrl(request)).pipe(Effect.map((r) => r.body)),
        )
        .handleRaw("execute", ({ urlParams, request }) =>
          InternalHandler.verifyAndParseRequestBody(request).pipe(
            Effect.provide(SignatureLive),
            Effect.flatMap((payload) =>
              InternalHandler.handleExecution(group, urlParams.fnId, urlParams.stepId, payload),
            ),
            Effect.map((r) => r.body),
          ),
        ),
  ) as Layer.Layer<HttpApiGroup.ApiGroup<ApiId, "inngest">, never, InngestClient | HttpClient.HttpClient>;
};
