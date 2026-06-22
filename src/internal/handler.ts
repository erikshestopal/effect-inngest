import * as HttpClient from "effect/unstable/http/HttpClient";
import * as HttpClientRequest from "effect/unstable/http/HttpClientRequest";
import * as HttpClientResponse from "effect/unstable/http/HttpClientResponse";
import * as HttpServerRequest from "effect/unstable/http/HttpServerRequest";
import { Cause, Context, Effect, Option, Predicate, Schema } from "effect";
import { InngestClient } from "../Client.js";
import type { InngestFunction } from "../Function.js";
import type { InngestGroup } from "../Group.js";
import * as Checkpoint from "./checkpoint.js";
import { SignatureError } from "./serve/Signature.js";
import * as SdkRequest from "./serve/Request.js";
import * as Protocol from "./protocol.js";
export { SignatureError } from "./serve/Signature.js";
import { execute } from "./driver.js";

export class InvalidRequestError extends Schema.TaggedErrorClass<InvalidRequestError>()("InvalidRequestError", {
  message: Schema.String,
}) {}

const SDK_VERSION = "2.0.0";

const baseHeaders = (framework?: string): Record<string, string> => ({
  "Content-Type": "application/json",
  "User-Agent": `effect-inngest:v${SDK_VERSION}`,
  [Protocol.Headers.SDK]: `effect-inngest:v${SDK_VERSION}`,
  [Protocol.Headers.SDKHandled]: "true",
  [Protocol.Headers.RequestVersion]: "2",
  ...(framework ? { [Protocol.Headers.Framework]: framework } : {}),
});

const buildServeUrl = (args: {
  readonly requestUrl: string;
  readonly serveHost?: string;
  readonly servePath?: string;
}): URL => {
  const url = new URL(args.requestUrl);
  if (args.servePath) {
    url.pathname = args.servePath;
  }
  if (args.serveHost) {
    return new URL(url.pathname + url.search, args.serveHost);
  }
  return url;
};

export interface HandlerResponse<T> {
  readonly status: number;
  readonly headers: Record<string, string>;
  readonly body: T;
}

export const verifyAndParseRequestBody = Effect.fn("effect-inngest/handler/verifyAndParseRequestBody")(function* (
  request: HttpServerRequest.HttpServerRequest,
) {
  const body = yield* SdkRequest.bodyUint8Array(request).pipe(
    Effect.mapError((error) => {
      const msg =
        Predicate.hasProperty(error, "message") && Predicate.isString(error.message) ? error.message : "unknown";
      return new InvalidRequestError({ message: `Failed to read request body: ${msg}` });
    }),
  );

  yield* SdkRequest.verifySignature(body, request);

  return yield* SdkRequest.schemaBodyJson(Protocol.SDKRequestBody)(body).pipe(
    Effect.mapError((error) => new InvalidRequestError({ message: `Invalid request body: ${String(error)}` })),
  );
});

export const handleIntrospection = Effect.fn("effect-inngest/handler/handleIntrospection")(function* (
  group: InngestGroup.Any,
  _requestUrl: string,
) {
  const client = yield* InngestClient;
  const config = client.config;

  const body: typeof Protocol.IntrospectionResponse.Type = {
    extra: {
      native_crypto: globalThis.crypto?.subtle ? true : false,
    },
    has_event_key: Predicate.isNotUndefined(config.eventKey),
    has_signing_key: Predicate.isNotUndefined(config.signingKey),
    function_count: group.functions.size,
    mode: client.mode === "dev" ? "dev" : "cloud",
    schema_version: "2024-05-24",
  };

  return { status: 200, headers: baseHeaders(config.framework), body } as HandlerResponse<
    typeof Protocol.IntrospectionResponse.Type
  >;
});

export const handleRegistration = Effect.fn("effect-inngest/handler/handleRegistration")(function* (
  group: InngestGroup.Any,
  requestUrl: string,
) {
  const client = yield* InngestClient;
  const httpClient = yield* HttpClient.HttpClient;
  const config = client.config;
  const url = buildServeUrl({ requestUrl, serveHost: config.serveHost, servePath: config.servePath });

  const functions = Array.from(group.functions.values()).map((fn) =>
    fn.toRegistration({ appId: config.id, url: url.href }),
  );
  const framework = config.framework;

  const registerUrl = new URL("fn/register", client.apiBaseUrl).toString();
  const registerHeaders = baseHeaders(framework);
  delete registerHeaders[Protocol.Headers.RequestVersion];

  const request = HttpClientRequest.post(registerUrl).pipe(
    HttpClientRequest.setHeaders({
      ...registerHeaders,
      Authorization: `Bearer ${config.signingKey ?? ""}`,
      [Protocol.Headers.SyncKind]: "out_of_band",
    }),
    HttpClientRequest.bodyJsonUnsafe({
      url: url.href,
      deployType: "ping" as const,
      ...(framework ? { framework } : {}),
      appName: config.id,
      functions,
      sdk: `effect-inngest:v${SDK_VERSION}`,
      v: "0.1",
      capabilities: {
        trust_probe: "v1",
        connect: "v1",
      },
    }),
  );

  // Spec §4.3.1: PUT sync responds with `{ message: string; modified: boolean }`.
  // Spec §4.3.3 / §4.3.4: 500 on failure with `modified: false`; 200 on success
  // with the executor-supplied `modified` value (or `false` if omitted).
  return yield* Effect.gen(function* () {
    const response = yield* httpClient.execute(request).pipe(Effect.scoped);
    const responseBody = yield* HttpClientResponse.schemaBodyJson(Protocol.RegisterServerResponse)(response).pipe(
      Effect.catch(() => Effect.succeed({ error: "Unknown registration response" } as const)),
    );

    if (response.status !== 200 || !Predicate.hasProperty(responseBody, "ok")) {
      return {
        status: 500,
        headers: baseHeaders(config.framework),
        body: {
          message:
            Predicate.hasProperty(responseBody, "error") && responseBody.error
              ? responseBody.error
              : `Registration failed with status ${response.status}`,
          modified: false,
        },
      } as HandlerResponse<typeof Protocol.RegisterResponse.Type>;
    }

    return {
      status: 200,
      headers: { ...baseHeaders(config.framework), [Protocol.Headers.SyncKind]: "out_of_band" },
      body: {
        message: "Successfully registered",
        modified: responseBody.modified ?? false,
      },
    } as HandlerResponse<typeof Protocol.RegisterResponse.Type>;
  }).pipe(
    Effect.catchCause((cause) => {
      // Network/transport failure (e.g. die from HttpClient mock). Per
      // §4.3.3 SHOULD return 500 with the body shape; never let the
      // toWebHandler default 500 wrapper escape.
      const errorOpt = Cause.findErrorOption(cause);
      const dieReason = cause.reasons.find(Cause.isDieReason);
      const message = Option.isSome(errorOpt)
        ? Predicate.hasProperty(errorOpt.value, "message") && Predicate.isString(errorOpt.value.message)
          ? errorOpt.value.message
          : "Registration failed"
        : dieReason
          ? Predicate.hasProperty(dieReason.defect, "message") && Predicate.isString(dieReason.defect.message)
            ? dieReason.defect.message
            : "Registration failed"
          : "Registration failed";
      return Effect.succeed({
        status: 500,
        headers: baseHeaders(config.framework),
        body: { message, modified: false },
      } as HandlerResponse<typeof Protocol.RegisterResponse.Type>);
    }),
  );
});

export interface Handler<Tag extends string> {
  readonly tag: Tag;
  readonly handler: (ctx: any) => Effect.Effect<any, any, any>;
  readonly context: Context.Context<any>;
}

export const handleExecution = Effect.fn("effect-inngest/handler/handleExecution")(function* (args: {
  readonly group: InngestGroup.Any;
  readonly fnId: string;
  readonly urlStepId: string | undefined;
  readonly body: typeof Protocol.SDKRequestBody.Type;
}) {
  const client = yield* InngestClient;
  const context = yield* Effect.context<never>();

  const appId = client.config.id;
  const prefix = `${appId}-`;
  const fnTag = args.fnId.startsWith(prefix) ? args.fnId.slice(prefix.length) : args.fnId;

  const fn = args.group.functions.get(fnTag) as InngestFunction.Any | undefined;
  const entry = fn ? (context.mapUnsafe.get(fn.key) as Handler<string> | undefined) : undefined;

  if (!fn || !entry) {
    // Spec §4.4.1: unknown function MUST return 500 with the error payload
    // at the response root (no { error: ... } envelope).
    // Spec §4.4.3 pair rule: 500 MUST pair with X-Inngest-No-Retry: false.
    return {
      status: 500 as const,
      headers: { ...baseHeaders(client.config.framework), [Protocol.Headers.NoRetry]: "false" },
      body: Protocol.UserError.make({ name: "FunctionNotFoundError", message: `Unknown function: ${args.fnId}` }),
    };
  }

  const requestedStepId = args.urlStepId === "step" ? undefined : args.urlStepId;

  // Non-root URL stepId takes precedence over body.ctx.step_id. The root
  // `stepId=step` identifies the function run step, not a targeted child step.
  const effectiveBody =
    requestedStepId && requestedStepId !== args.body.ctx.step_id
      ? Protocol.SDKRequestBody.make({
          event: args.body.event,
          events: args.body.events,
          steps: args.body.steps,
          ctx: Protocol.SDKRequestContext.make({
            fn_id: args.body.ctx.fn_id,
            run_id: args.body.ctx.run_id,
            env: args.body.ctx.env,
            step_id: requestedStepId,
            attempt: args.body.ctx.attempt,
            max_attempts: args.body.ctx.max_attempts,
            qi_id: args.body.ctx.qi_id,
            ...(Predicate.isNotUndefined(args.body.ctx.request_id) ? { request_id: args.body.ctx.request_id } : {}),
            ...(Predicate.isNotUndefined(args.body.ctx.generation_id)
              ? { generation_id: args.body.ctx.generation_id }
              : {}),
            disable_immediate_execution: args.body.ctx.disable_immediate_execution,
            use_api: args.body.ctx.use_api,
            stack: args.body.ctx.stack,
          }),
          version: args.body.version,
          use_api: args.body.use_api,
        })
      : args.body;

  // Checkpoint mode entry decision (spec §10):
  //   - non-root URL stepId NOT set (we are not running a targeted child step)
  //   - ctx.fn_id present (executor knows the function)
  //   - ctx.disable_immediate_execution false (executor allowed it)
  //   - resolved per-fn or per-client config not opted out
  const enterCheckpoint =
    !requestedStepId &&
    effectiveBody.ctx.fn_id !== "" &&
    !effectiveBody.ctx.disable_immediate_execution &&
    effectiveBody.ctx.attempt === 0;
  const checkpointConfig = enterCheckpoint
    ? Option.fromNullishOr(Checkpoint.resolveConfig(fn.options.checkpointing, client.config.checkpointing))
    : Option.none<Checkpoint.CheckpointConfig>();

  const result = yield* Effect.provide(
    execute({ fn, handler: entry.handler, request: effectiveBody, checkpointConfig }),
    entry.context,
  );
  return { status: result.status, headers: result.headers, body: result.body } as HandlerResponse<unknown>;
});
