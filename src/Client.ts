/**
 * @since 0.1.0
 */
import * as HttpClient from "effect/unstable/http/HttpClient";
import * as HttpClientRequest from "effect/unstable/http/HttpClientRequest";
import * as HttpClientResponse from "effect/unstable/http/HttpClientResponse";
import { Clock, Config, Context, Effect, Layer, Option, Predicate, Ref, Schedule, Schema } from "effect";
import { CheckpointApiError, type CheckpointingOption } from "./internal/checkpoint.js";
import * as Protocol from "./internal/protocol.js";
import { hashSigningKey } from "./internal/signature.js";

export type { CheckpointingOption } from "./internal/checkpoint.js";
export { CheckpointApiError } from "./internal/checkpoint.js";

/**
 * @since 0.1.0
 * @category type ids
 * @internal
 */
const TypeId: unique symbol = Symbol.for("effect-inngest/Client");

/**
 * @since 0.1.0
 * @category type ids
 * @internal
 */
type TypeId = typeof TypeId;

const DEFAULT_EVENT_BASE_URL = "https://inn.gs/";
const DEFAULT_API_BASE_URL = "https://api.inngest.com/";
const DEFAULT_DEV_SERVER_URL = "http://localhost:8288/";
const SDK_VERSION = "2.0.0";

type ClientMode = "dev" | "cloud";

interface ClientConfig {
  /**
   * The ID of this instance, most commonly a reference to the application it
   * resides in.
   *
   * The ID of your client should remain the same for its lifetime; if you'd
   * like to change the name of your client as it appears in the Inngest UI,
   * change the `name` property instead.
   */
  readonly id: string;

  /**
   * Inngest event key, used to send events to Inngest Cloud. If not provided,
   * will search for the `INNGEST_EVENT_KEY` environment variable. If neither
   * can be found, a warning will be shown and any attempts to send events in
   * cloud mode will throw an error.
   */
  readonly eventKey?: string | undefined;

  /**
   * Inngest signing key, used for request signature verification.
   * If not provided, will search for the `INNGEST_SIGNING_KEY` environment variable.
   */
  readonly signingKey?: string | undefined;

  /**
   * Fallback signing key for key rotation scenarios.
   * If not provided, will search for the `INNGEST_SIGNING_KEY_FALLBACK` environment variable.
   */
  readonly signingKeyFallback?: string | undefined;

  /**
   * The base URL for the Inngest API (registration, run fetching, etc.)
   * Defaults to https://api.inngest.com/ in cloud mode.
   */
  readonly apiBaseUrl?: string | undefined;

  /**
   * The base URL for sending events.
   * Defaults to https://inn.gs/ in cloud mode.
   */
  readonly eventBaseUrl?: string | undefined;

  /**
   * Can be used to explicitly set the client to Development Mode or Cloud Mode.
   * If not set, mode is inferred from environment variables (INNGEST_DEV, NODE_ENV, etc.)
   *
   * Development mode will turn off signature verification and default to using
   * a local URL to access a local Dev Server.
   */
  readonly mode?: ClientMode | undefined;

  /**
   * The Inngest environment to send events to. Defaults to whichever
   * environment this client's event key is associated with.
   *
   * It's likely you never need to change this unless you're trying to sync
   * multiple systems together using branch names.
   */
  readonly env?: string | undefined;

  /**
   * The application-specific version identifier. This can be an arbitrary value
   * such as a version string, a Git commit SHA, or any other unique identifier.
   */
  readonly appVersion?: string | undefined;

  /**
   * The host where this app is served. Used for registration.
   */
  readonly serveHost?: string | undefined;

  /**
   * The path where the Inngest serve handler is mounted. Used for registration.
   */
  readonly servePath?: string | undefined;

  /**
   * The framework adapter serving this app, e.g. "bun" or "nodejs". Used for
   * protocol headers and registration metadata.
   */
  readonly framework?: string | undefined;

  /**
   * Whether to use checkpointing by default for executions of functions
   * created using this client.
   *
   * - `false` disables checkpointing for all functions on this client.
   * - `true` enables checkpointing with safe defaults (`bufferedSteps: 1`,
   *   `maxInterval: 0`, `maxRuntime: 10s`). Steps are checkpointed to the
   *   Inngest API as they complete instead of yielding a 206 per step.
   * - An object lets you tune `bufferedSteps`, `maxInterval`, `maxRuntime`.
   *
   * Per-function `checkpointing` overrides this setting. Defaults to `true`
   * (checkpointing enabled).
   *
   * @default true
   */
  readonly checkpointing?: CheckpointingOption | undefined;
}

export const EventPayload = Schema.Struct({
  name: Schema.String,
  data: Schema.Unknown,
  ts: Schema.optional(Schema.Number),
  id: Schema.optional(Schema.String),
  v: Schema.optional(Schema.String),
});

const SendEventResponse = Schema.Struct({
  ids: Schema.Array(Schema.String).pipe(Schema.withDecodingDefault(Effect.succeed([]))),
  status: Schema.optional(Schema.Number),
});

type EventPayload = typeof EventPayload.Type;
type SendEventResponse = typeof SendEventResponse.Type;

class SendEventError extends Schema.TaggedErrorClass<SendEventError>()("SendEventError", {
  message: Schema.String,
  events: Schema.Array(Schema.String),
}) {}

interface InngestClientService {
  readonly [TypeId]: TypeId;
  readonly config: ClientConfig;
  readonly mode: ClientMode;
  readonly eventBaseUrl: string;
  readonly apiBaseUrl: string;
  readonly sendEvent: (events: ReadonlyArray<EventPayload>) => Effect.Effect<SendEventResponse, SendEventError>;
  /**
   * Async checkpoint API call per spec §10.3.1.
   *
   * POSTs `{run_id, fn_id, qi_id, steps, ts}` to
   * `{apiBaseUrl}/v1/checkpoint/{runId}/async` with a hashed-signing-key
   * Bearer token. Retries 5xx responses with exponential backoff + jitter
   * (5 attempts). On 401, falls back to the configured fallback signing key
   * for the remainder of the client's lifetime (one-way switch).
   *
   * @internal
   */
  readonly checkpointAsync: (args: {
    readonly runId: string;
    readonly fnId: string;
    readonly qiId: string;
    readonly requestId?: string;
    readonly generationId?: number;
    readonly requestStartedAt?: number;
    readonly steps: ReadonlyArray<typeof Protocol.GeneratorOpcode.Type>;
  }) => Effect.Effect<void, CheckpointApiError>;
}

/**
 * InngestClient service for communicating with Inngest.
 *
 * @since 0.1.0
 * @category context
 */
export class InngestClient extends Context.Service<InngestClient, InngestClientService>()(
  "effect-inngest/InngestClient",
) {}

const resolveMode = (config: ClientConfig): ClientMode => config.mode ?? "dev";

const resolveEventBaseUrl = (config: ClientConfig, mode: ClientMode): string =>
  config.eventBaseUrl ?? (mode === "dev" ? DEFAULT_DEV_SERVER_URL : DEFAULT_EVENT_BASE_URL);

const resolveApiBaseUrl = (config: ClientConfig, mode: ClientMode): string =>
  config.apiBaseUrl ?? (mode === "dev" ? DEFAULT_DEV_SERVER_URL : DEFAULT_API_BASE_URL);

const isRetriable = (error: CheckpointApiError): boolean => Predicate.isUndefined(error.status) || error.status >= 500;

const defaultCheckpointRetrySchedule: Schedule.Schedule<unknown, CheckpointApiError> = Schedule.exponential(
  "100 millis",
  2.0,
).pipe(
  Schedule.jittered,
  Schedule.both(Schedule.recurs(5)),
  Schedule.while((m: Schedule.Metadata<unknown, CheckpointApiError>) => isRetriable(m.input)),
);

const makeClient = (
  config: ClientConfig,
  httpClient: HttpClient.HttpClient,
  retrySchedule: Schedule.Schedule<unknown, CheckpointApiError> = defaultCheckpointRetrySchedule,
): Effect.Effect<InngestClientService> =>
  Effect.gen(function* () {
    const mode = resolveMode(config);
    const eventBaseUrl = resolveEventBaseUrl(config, mode);
    const apiBaseUrl = resolveApiBaseUrl(config, mode);

    /**
     * One-way switch: once the fallback signing key succeeds for any
     * checkpoint API call, all subsequent calls use it first. Per spec
     * §10.3.4.
     */
    const useFallbackKey = yield* Ref.make(false);

    const sendEvent = Effect.fn("InngestClient.sendEvent")(function* (events: ReadonlyArray<EventPayload>) {
      if (!config.eventKey && mode === "cloud") {
        return yield* Effect.fail(
          new SendEventError({
            message: "Event key is required to send events in cloud mode",
            events: events.map((e) => e.name),
          }),
        );
      }

      const key = config.eventKey ?? "NO_EVENT_KEY_SET";
      const url = new URL(`e/${key}`, eventBaseUrl).toString();
      const eventNames = events.map((e) => e.name);
      const now = yield* Clock.currentTimeMillis;

      const payloads = events.map((e) => ({
        name: e.name,
        data: e.data ?? {},
        ts: e.ts ?? now,
        id: e.id,
        v: e.v,
      }));

      const request = HttpClientRequest.post(url).pipe(
        HttpClientRequest.setHeaders({
          "Content-Type": "application/json",
          [Protocol.Headers.SDK]: `effect-ts:v${SDK_VERSION}`,
          ...(config.env ? { [Protocol.Headers.Env]: config.env } : {}),
        }),
      );

      return yield* HttpClientRequest.schemaBodyJson(Schema.Array(EventPayload))(request, payloads).pipe(
        Effect.flatMap(httpClient.execute),
        Effect.flatMap(HttpClientResponse.schemaBodyJson(SendEventResponse)),
        Effect.map((response) => ({ ids: response.ids, status: response.status })),
        Effect.scoped,
        Effect.catch((error) =>
          Effect.fail(
            new SendEventError({
              message: `Failed to send events: ${Predicate.hasProperty(error, "message") ? (error.message as string) : "Unknown error"}`,
              events: eventNames,
            }),
          ),
        ),
      );
    });

    /**
     * Issue a checkpoint POST with the given signing key. Returns a tagged
     * error on non-2xx so the caller can decide whether to retry, swap keys,
     * or fall back.
     */
    const checkpointRequest = (
      runId: string,
      body: string,
      hashedSigningKey: string,
    ): Effect.Effect<void, CheckpointApiError> => {
      const url = new URL(`v1/checkpoint/${runId}/async`, apiBaseUrl).toString();
      const request = HttpClientRequest.post(url).pipe(
        HttpClientRequest.setHeaders({
          "Content-Type": "application/json",
          ...(config.env ? { [Protocol.Headers.Env]: config.env } : {}),
        }),
        HttpClientRequest.bearerToken(hashedSigningKey),
        HttpClientRequest.bodyText(body, "application/json"),
      );

      return httpClient.execute(request).pipe(
        Effect.scoped,
        Effect.catch((error) =>
          Effect.fail(
            new CheckpointApiError({
              message: `Network error issuing checkpoint: ${Predicate.hasProperty(error, "message") ? (error.message as string) : String(error)}`,
            }),
          ),
        ),
        Effect.flatMap((response) => {
          if (response.status >= 200 && response.status < 300) {
            return Effect.void;
          }
          return Effect.fail(
            new CheckpointApiError({
              message: `Checkpoint API returned ${response.status}`,
              status: response.status,
            }),
          );
        }),
      );
    };

    const checkpointAsync: InngestClientService["checkpointAsync"] = Effect.fn("InngestClient.checkpointAsync")(
      function* (args) {
        const signingKey = config.signingKey;
        if (!signingKey && mode !== "dev") {
          return yield* Effect.fail(
            new CheckpointApiError({ message: "No signing key configured for checkpoint API" }),
          );
        }

        const now = yield* Clock.currentTimeMillis;
        const body = JSON.stringify({
          run_id: args.runId,
          fn_id: args.fnId,
          qi_id: args.qiId,
          request_id: args.requestId,
          generation_id: args.generationId,
          request_started_at: args.requestStartedAt,
          steps: args.steps,
          ts: now,
        });

        const fallbackKey = config.signingKeyFallback;

        // Single attempt: tries the chosen key first; on 401 with primary,
        // tries the fallback once and flips the Ref.
        const attempt: Effect.Effect<void, CheckpointApiError> = Ref.get(useFallbackKey).pipe(
          Effect.flatMap((usingFallback) => {
            const primaryKey = usingFallback && fallbackKey ? fallbackKey : signingKey;
            const primaryToken = primaryKey ? hashSigningKey(primaryKey) : "";
            return checkpointRequest(args.runId, body, primaryToken).pipe(
              Effect.catch((error) =>
                error.status === 401 && !usingFallback && fallbackKey
                  ? checkpointRequest(args.runId, body, hashSigningKey(fallbackKey)).pipe(
                      Effect.andThen(Ref.set(useFallbackKey, true)),
                    )
                  : Effect.fail(error),
              ),
            );
          }),
        );

        return yield* attempt.pipe(Effect.retry(retrySchedule));
      },
    );

    return {
      [TypeId]: TypeId,
      config,
      mode,
      eventBaseUrl,
      apiBaseUrl,
      sendEvent,
      checkpointAsync,
    };
  });

/**
 * Create an InngestClient layer from a config.
 *
 * @since 0.1.0
 * @category layers
 * @example
 * ```ts
 * const ClientLive = InngestClient.layer({
 *   id: "my-app",
 *   eventKey: "my-event-key",
 * })
 * ```
 */
export const layer = (config: ClientConfig): Layer.Layer<InngestClient, never, HttpClient.HttpClient> =>
  Layer.effect(
    InngestClient,
    Effect.gen(function* () {
      const httpClient = yield* HttpClient.HttpClient;
      return yield* makeClient(config, httpClient);
    }),
  );

// Test-only factory attached via Symbol.for; not a named export, not in
// TypeScript autocomplete, not in the public `InngestClient.*` namespace.
// Tests retrieve it by re-deriving the same global symbol. Do not use from
// application code.
const TEST_FACTORY_KEY = Symbol.for("effect-inngest/internal/test-retry-schedule-factory");
(InngestClient as unknown as Record<symbol, unknown>)[TEST_FACTORY_KEY] = (
  config: ClientConfig,
  retrySchedule: Schedule.Schedule<unknown, CheckpointApiError>,
): Layer.Layer<InngestClient, never, HttpClient.HttpClient> =>
  Layer.effect(
    InngestClient,
    Effect.gen(function* () {
      const httpClient = yield* HttpClient.HttpClient;
      return yield* makeClient(config, httpClient, retrySchedule);
    }),
  );

/**
 * Create an InngestClient layer from Effect Config.
 *
 * @since 0.1.0
 * @category layers
 */
export const layerConfig = (
  config: Config.Wrap<ClientConfig>,
): Layer.Layer<InngestClient, Config.ConfigError, HttpClient.HttpClient> =>
  Layer.effect(
    InngestClient,
    Effect.gen(function* () {
      const resolvedConfig = yield* Config.unwrap(config);
      const httpClient = yield* HttpClient.HttpClient;
      return yield* makeClient(resolvedConfig, httpClient);
    }),
  );

/**
 * Create an InngestClient layer from environment variables.
 *
 * Uses:
 * - INNGEST_APP_ID or "app" as id
 * - INNGEST_EVENT_KEY for event key
 * - INNGEST_SIGNING_KEY for signing key
 *
 * Mode is inferred from environment (INNGEST_DEV, NODE_ENV, etc.)
 *
 * @since 0.1.0
 * @category layers
 */
export const layerFromEnv: Layer.Layer<InngestClient, Config.ConfigError, HttpClient.HttpClient> = layerConfig(
  Config.all({
    id: Config.string("INNGEST_APP_ID").pipe(Config.withDefault("app")),
    eventKey: Config.string("INNGEST_EVENT_KEY").pipe(Config.option, Config.map(Option.getOrUndefined)),
    signingKey: Config.string("INNGEST_SIGNING_KEY").pipe(Config.option, Config.map(Option.getOrUndefined)),
    signingKeyFallback: Config.string("INNGEST_SIGNING_KEY_FALLBACK").pipe(
      Config.option,
      Config.map(Option.getOrUndefined),
    ),
  }),
);
