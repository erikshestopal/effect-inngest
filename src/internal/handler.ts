/**
 * Internal handler implementation.
 * @internal
 */
import * as HttpClient from "@effect/platform/HttpClient";
import * as HttpClientRequest from "@effect/platform/HttpClientRequest";
import * as HttpClientResponse from "@effect/platform/HttpClientResponse";
import * as HttpServerRequest from "@effect/platform/HttpServerRequest";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Predicate from "effect/Predicate";
import * as Schema from "effect/Schema";
import { InngestClient } from "../Client.js";
import type { InngestFunction } from "../Function.js";
import type { InngestGroup } from "../Group.js";
import { Signature, SignatureError } from "./signature.js";
import * as Protocol from "./protocol.js";
export { SignatureError } from "./signature.js";
import { execute, type TraceHeaders } from "./driver.js";
export type { TraceHeaders } from "./driver.js";

export class InvalidRequestError extends Schema.TaggedError<InvalidRequestError>()("InvalidRequestError", {
  message: Schema.String,
}) {}

const SDK_VERSION = "2.0.0";

const baseHeaders = (): Record<string, string> => ({
  "Content-Type": "application/json",
  [Protocol.Headers.SDK]: `effect-inngest:v${SDK_VERSION}`,
  [Protocol.Headers.RequestVersion]: "1",
});

const buildServeUrl = (requestUrl: string, serveHost?: string, servePath?: string): URL => {
  const url = new URL(requestUrl);
  if (servePath) {
    url.pathname = servePath;
  }
  if (serveHost) {
    return new URL(url.pathname + url.search, serveHost);
  }
  return url;
};

export interface HandlerResponse<T> {
  readonly status: number;
  readonly headers: Record<string, string>;
  readonly body: T;
}

export const verifyAndParseRequestBody = (
  request: HttpServerRequest.HttpServerRequest,
): Effect.Effect<
  typeof Protocol.SDKRequestBody.Type,
  SignatureError | InvalidRequestError,
  InngestClient | Signature
> =>
  Effect.gen(function* () {
    const client = yield* InngestClient;
    const sig = yield* Signature;
    const config = client.config;
    const isDev = client.mode === "dev";

    const bodyText = yield* request.text.pipe(
      Effect.mapError((error) => new InvalidRequestError({ message: `Failed to read request body: ${String(error)}` })),
    );

    yield* sig.verify({
      body: new TextEncoder().encode(bodyText),
      signatureHeader: request.headers[Protocol.Headers.Signature.toLowerCase()],
      signingKey: config.signingKey,
      signingKeyFallback: config.signingKeyFallback,
      isDev,
    });

    return yield* Schema.decodeUnknown(Schema.parseJson(Protocol.SDKRequestBody))(bodyText).pipe(
      Effect.mapError((error) => new InvalidRequestError({ message: `Invalid request body: ${String(error)}` })),
    );
  });

export const handleIntrospection = (
  group: InngestGroup.Any,
  _requestUrl: string,
): Effect.Effect<HandlerResponse<typeof Protocol.IntrospectionResponse.Type>, never, InngestClient> =>
  Effect.gen(function* () {
    const client = yield* InngestClient;
    const config = client.config;

    const body: typeof Protocol.IntrospectionResponse.Type = {
      function_count: group.functions.size,
      has_event_key: config.eventKey !== undefined,
      has_signing_key: config.signingKey !== undefined,
      has_signing_key_fallback: config.signingKeyFallback !== undefined,
      mode: client.mode === "dev" ? "dev" : "cloud",
      schema_version: "2024-05-24",
      authentication_succeeded: null,
    };

    return { status: 200, headers: baseHeaders(), body };
  });

const RegisterRequest = Schema.Struct({
  url: Schema.String,
  v: Schema.String,
  deployType: Schema.Literal("ping"),
  sdk: Schema.String,
  appName: Schema.String,
  framework: Schema.String,
  functions: Schema.Array(Schema.Unknown),
});

export const handleRegistration = (
  group: InngestGroup.Any,
  requestUrl: string,
): Effect.Effect<
  HandlerResponse<typeof Protocol.RegisterResponse.Type>,
  never,
  InngestClient | HttpClient.HttpClient
> =>
  Effect.gen(function* () {
    const client = yield* InngestClient;
    const httpClient = yield* HttpClient.HttpClient;
    const config = client.config;
    const url = buildServeUrl(requestUrl, config.serveHost, config.servePath);

    const functions = Array.from(group.functions.values()).map((fn) =>
      fn.toRegistration({ appId: config.id, url: url.href }),
    );

    const registerUrl = new URL("fn/register", client.apiBaseUrl).toString();
    const request = HttpClientRequest.post(registerUrl).pipe(
      HttpClientRequest.setHeaders({
        ...baseHeaders(),
        Authorization: `Bearer ${config.signingKey ?? ""}`,
      }),
      HttpClientRequest.schemaBodyJson(RegisterRequest)({
        url: url.href,
        v: "0.1",
        deployType: "ping" as const,
        sdk: `effect-inngest:v${SDK_VERSION}`,
        appName: config.id,
        framework: "effect",
        functions,
      }),
    );

    const response = yield* request.pipe(
      Effect.flatMap(httpClient.execute),
      Effect.flatMap(HttpClientResponse.schemaBodyJson(Protocol.RegisterResponse)),
      Effect.scoped,
      Effect.catchAll((error) =>
        Effect.succeed({
          message: `Registration failed: ${Predicate.hasProperty(error, "message") ? (error.message as string) : "Unknown error"}`,
        }),
      ),
    );

    return {
      status: 200,
      headers: baseHeaders(),
      body: response,
    };
  });

export interface Handler<Tag extends string> {
  readonly tag: Tag;
  readonly handler: (ctx: any) => Effect.Effect<any, any, any>;
  readonly context: Context.Context<any>;
}

export const handleExecution = (
  group: InngestGroup.Any,
  fnId: string,
  urlStepId: string | undefined,
  body: typeof Protocol.SDKRequestBody.Type,
  traceHeaders: TraceHeaders = {},
): Effect.Effect<HandlerResponse<unknown>, never, InngestClient> =>
  Effect.gen(function* () {
    const client = yield* InngestClient;
    const context = yield* Effect.context<never>();

    const appId = client.config.id;
    const prefix = `${appId}-`;
    const fnTag = fnId.startsWith(prefix) ? fnId.slice(prefix.length) : fnId;

    const fn = group.functions.get(fnTag) as InngestFunction.Any | undefined;
    const entry = fn ? (context.unsafeMap.get(fn.key) as Handler<string> | undefined) : undefined;

    if (!fn || !entry) {
      return {
        status: 404 as const,
        headers: { ...baseHeaders(), [Protocol.Headers.NoRetry]: "true" },
        body: {
          error: Protocol.UserError.make({ name: "FunctionNotFoundError", message: `Unknown function: ${fnId}` }),
        },
      };
    }

    // URL stepId takes precedence over body.ctx.step_id
    // This is how Inngest requests execution of a specific step
    const effectiveBody =
      urlStepId && urlStepId !== body.ctx.step_id
        ? Protocol.SDKRequestBody.make({
            event: body.event,
            events: body.events,
            steps: body.steps,
            ctx: Protocol.SDKRequestContext.make({
              fn_id: body.ctx.fn_id,
              run_id: body.ctx.run_id,
              step_id: urlStepId,
              attempt: body.ctx.attempt,
              disable_immediate_execution: body.ctx.disable_immediate_execution,
              use_api: body.ctx.use_api,
              stack: body.ctx.stack,
            }),
            use_api: body.use_api,
          })
        : body;

    const result = yield* Effect.provide(execute(fn, entry.handler, effectiveBody, appId, traceHeaders), entry.context);
    return { status: result.status, headers: result.headers, body: result.body };
  });
