/**
 * Internal handler implementation.
 * @internal
 */
import * as Headers from "effect/unstable/http/Headers";
import * as HttpClient from "effect/unstable/http/HttpClient";
import * as HttpClientRequest from "effect/unstable/http/HttpClientRequest";
import * as HttpClientResponse from "effect/unstable/http/HttpClientResponse";
import * as HttpServerRequest from "effect/unstable/http/HttpServerRequest";
import * as Cause from "effect/Cause";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Predicate from "effect/Predicate";
import * as Schema from "effect/Schema";
import { InngestClient } from "../Client.js";
import type { InngestFunction } from "../Function.js";
import type { InngestGroup } from "../Group.js";
import * as Checkpoint from "./checkpoint.js";
import { Signature, SignatureError } from "./signature.js";
import * as Protocol from "./protocol.js";
export { SignatureError } from "./signature.js";
import { execute, type TraceHeaders } from "./driver.js";
export type { TraceHeaders } from "./driver.js";

export class InvalidRequestError extends Schema.TaggedErrorClass<InvalidRequestError>()("InvalidRequestError", {
  message: Schema.String,
}) {}

const SDK_VERSION = "2.0.0";

const baseHeaders = (): Record<string, string> => ({
  "Content-Type": "application/json",
  "User-Agent": `effect-inngest:v${SDK_VERSION}`,
  [Protocol.Headers.SDK]: `effect-inngest:v${SDK_VERSION}`,
  [Protocol.Headers.SDKHandled]: "true",
  [Protocol.Headers.RequestVersion]: "2",
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

export const verifyAndParseRequestBody = Effect.fn("effect-inngest/handler/verifyAndParseRequestBody")(function* (
  request: HttpServerRequest.HttpServerRequest,
) {
  const client = yield* InngestClient;
  const sig = yield* Signature;
  const config = client.config;
  const isDev = client.mode === "dev";

  const bodyText = yield* request.text.pipe(
    Effect.mapError((error) => {
      const msg =
        Predicate.hasProperty(error, "message") && typeof error.message === "string" ? error.message : "unknown";
      return new InvalidRequestError({ message: `Failed to read request body: ${msg}` });
    }),
  );

  yield* sig.verify({
    body: new TextEncoder().encode(bodyText),
    signatureHeader: Option.getOrUndefined(Headers.get(request.headers, Protocol.Headers.Signature)),
    signingKey: config.signingKey,
    signingKeyFallback: config.signingKeyFallback,
    isDev,
  });

  return yield* Schema.decodeUnknownEffect(Schema.fromJsonString(Protocol.SDKRequestBody))(bodyText).pipe(
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
    has_event_key: config.eventKey !== undefined,
    has_signing_key: config.signingKey !== undefined,
    function_count: group.functions.size,
    mode: client.mode === "dev" ? "dev" : "cloud",
    schema_version: "2024-05-24",
  };

  return { status: 200, headers: baseHeaders(), body } as HandlerResponse<typeof Protocol.IntrospectionResponse.Type>;
});

export const handleRegistration = Effect.fn("effect-inngest/handler/handleRegistration")(function* (
  group: InngestGroup.Any,
  requestUrl: string,
) {
  const client = yield* InngestClient;
  const httpClient = yield* HttpClient.HttpClient;
  const config = client.config;
  const url = buildServeUrl(requestUrl, config.serveHost, config.servePath);

  const functions = Array.from(group.functions.values()).map((fn) =>
    fn.toRegistration({ appId: config.id, url: url.href }),
  );

  const registerUrl = new URL("fn/register", client.apiBaseUrl).toString();
  const registerHeaders = baseHeaders();
  delete registerHeaders[Protocol.Headers.RequestVersion];

  const request = HttpClientRequest.post(registerUrl).pipe(
    HttpClientRequest.setHeaders({
      ...registerHeaders,
      Authorization: `Bearer ${config.signingKey ?? ""}`,
      [Protocol.Headers.Framework]: "effect",
      [Protocol.Headers.SyncKind]: "out_of_band",
    }),
    HttpClientRequest.bodyJsonUnsafe({
      url: url.href,
      deployType: "ping" as const,
      framework: "effect",
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
        headers: baseHeaders(),
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
      headers: { ...baseHeaders(), [Protocol.Headers.SyncKind]: "out_of_band" },
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
        ? Predicate.hasProperty(errorOpt.value, "message") && typeof errorOpt.value.message === "string"
          ? errorOpt.value.message
          : "Registration failed"
        : dieReason
          ? Predicate.hasProperty(dieReason.defect, "message") && typeof dieReason.defect.message === "string"
            ? dieReason.defect.message
            : "Registration failed"
          : "Registration failed";
      return Effect.succeed({
        status: 500,
        headers: baseHeaders(),
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

export const handleExecution = Effect.fn("effect-inngest/handler/handleExecution")(function* (
  group: InngestGroup.Any,
  fnId: string,
  urlStepId: string | undefined,
  body: typeof Protocol.SDKRequestBody.Type,
  traceHeaders: TraceHeaders = {},
) {
  const client = yield* InngestClient;
  const context = yield* Effect.context<never>();

  const appId = client.config.id;
  const prefix = `${appId}-`;
  const fnTag = fnId.startsWith(prefix) ? fnId.slice(prefix.length) : fnId;

  const fn = group.functions.get(fnTag) as InngestFunction.Any | undefined;
  const entry = fn ? (context.mapUnsafe.get(fn.key) as Handler<string> | undefined) : undefined;

  if (!fn || !entry) {
    // Spec §4.4.1: unknown function MUST return 500 with the error payload
    // at the response root (no { error: ... } envelope).
    // Spec §4.4.3 pair rule: 500 MUST pair with X-Inngest-No-Retry: false.
    return {
      status: 500 as const,
      headers: { ...baseHeaders(), [Protocol.Headers.NoRetry]: "false" },
      body: Protocol.UserError.make({ name: "FunctionNotFoundError", message: `Unknown function: ${fnId}` }),
    };
  }

  const requestedStepId = urlStepId === "step" ? undefined : urlStepId;

  // Non-root URL stepId takes precedence over body.ctx.step_id. The root
  // `stepId=step` identifies the function run step, not a targeted child step.
  const effectiveBody =
    requestedStepId && requestedStepId !== body.ctx.step_id
      ? Protocol.SDKRequestBody.make({
          event: body.event,
          events: body.events,
          steps: body.steps,
          ctx: Protocol.SDKRequestContext.make({
            fn_id: body.ctx.fn_id,
            run_id: body.ctx.run_id,
            env: body.ctx.env,
            step_id: requestedStepId,
            attempt: body.ctx.attempt,
            max_attempts: body.ctx.max_attempts,
            qi_id: body.ctx.qi_id,
            disable_immediate_execution: body.ctx.disable_immediate_execution,
            use_api: body.ctx.use_api,
            stack: body.ctx.stack,
          }),
          version: body.version,
          use_api: body.use_api,
        })
      : body;

  // Checkpoint mode entry decision (spec §10):
  //   - non-root URL stepId NOT set (we are not running a targeted child step)
  //   - ctx.fn_id present (executor knows the function)
  //   - ctx.disable_immediate_execution false (executor allowed it)
  //   - resolved per-fn or per-client config not opted out
  const enterCheckpoint =
    !requestedStepId && effectiveBody.ctx.fn_id !== "" && !effectiveBody.ctx.disable_immediate_execution;
  const checkpointConfig = enterCheckpoint
    ? Option.fromNullishOr(Checkpoint.resolveConfig(fn.options.checkpointing, client.config.checkpointing))
    : Option.none<Checkpoint.CheckpointConfig>();

  const result = yield* Effect.provide(
    execute(fn, entry.handler, effectiveBody, appId, traceHeaders, checkpointConfig),
    entry.context,
  );
  return { status: result.status, headers: result.headers, body: result.body } as HandlerResponse<unknown>;
});
