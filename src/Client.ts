/**
 * @since 0.1.0
 */
import * as HttpClient from "@effect/platform/HttpClient";
import * as HttpClientRequest from "@effect/platform/HttpClientRequest";
import * as HttpClientResponse from "@effect/platform/HttpClientResponse";
import * as Config from "effect/Config";
import type * as ConfigError from "effect/ConfigError";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Predicate from "effect/Predicate";
import * as Schema from "effect/Schema";
import * as Protocol from "./internal/protocol.js";

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
}

export const EventPayload = Schema.Struct({
  name: Schema.String,
  data: Schema.Unknown,
  ts: Schema.optional(Schema.Number),
  id: Schema.optional(Schema.String),
  v: Schema.optional(Schema.String),
});

const SendEventResponse = Schema.Struct({
  ids: Schema.optionalWith(Schema.Array(Schema.String), { default: () => [] }),
  status: Schema.optional(Schema.Number),
});

type EventPayload = typeof EventPayload.Type;
type SendEventResponse = typeof SendEventResponse.Type;

class SendEventError extends Schema.TaggedError<SendEventError>()("SendEventError", {
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
}

/**
 * InngestClient service for communicating with Inngest.
 *
 * @since 0.1.0
 * @category context
 */
export class InngestClient extends Context.Tag("effect-inngest/InngestClient")<InngestClient, InngestClientService>() {}

const resolveMode = (config: ClientConfig): ClientMode => config.mode ?? "dev";

const resolveEventBaseUrl = (config: ClientConfig, mode: ClientMode): string =>
  config.eventBaseUrl ?? (mode === "dev" ? DEFAULT_DEV_SERVER_URL : DEFAULT_EVENT_BASE_URL);

const resolveApiBaseUrl = (config: ClientConfig, mode: ClientMode): string =>
  config.apiBaseUrl ?? (mode === "dev" ? DEFAULT_DEV_SERVER_URL : DEFAULT_API_BASE_URL);

const makeClient = (config: ClientConfig, httpClient: HttpClient.HttpClient): InngestClientService => {
  const mode = resolveMode(config);
  const eventBaseUrl = resolveEventBaseUrl(config, mode);
  const apiBaseUrl = resolveApiBaseUrl(config, mode);

  const sendEvent = (events: ReadonlyArray<EventPayload>): Effect.Effect<SendEventResponse, SendEventError> => {
    if (!config.eventKey && mode === "cloud") {
      return new SendEventError({
        message: "Event key is required to send events in cloud mode",
        events: events.map((e) => e.name),
      });
    }

    const key = config.eventKey ?? "local";
    const url = new URL(`e/${key}`, eventBaseUrl).toString();
    const eventNames = events.map((e) => e.name);
    const now = Date.now();

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

    return HttpClientRequest.schemaBodyJson(Schema.Array(EventPayload))(request, payloads).pipe(
      Effect.flatMap(httpClient.execute),
      Effect.flatMap(HttpClientResponse.schemaBodyJson(SendEventResponse)),
      Effect.map((response) => ({ ids: response.ids, status: response.status })),
      Effect.scoped,
      Effect.catchAll(
        (error) =>
          new SendEventError({
            message: `Failed to send events: ${Predicate.hasProperty(error, "message") ? (error.message as string) : "Unknown error"}`,
            events: eventNames,
          }),
      ),
    );
  };

  return {
    [TypeId]: TypeId,
    config,
    mode,
    eventBaseUrl,
    apiBaseUrl,
    sendEvent,
  };
};

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
    Effect.map(HttpClient.HttpClient, (httpClient) => makeClient(config, httpClient)),
  );

/**
 * Create an InngestClient layer from Effect Config.
 *
 * @since 0.1.0
 * @category layers
 */
export const layerConfig = (
  config: Config.Config.Wrap<ClientConfig>,
): Layer.Layer<InngestClient, ConfigError.ConfigError, HttpClient.HttpClient> =>
  Layer.effect(
    InngestClient,
    Effect.flatMap(Config.unwrap(config), (resolvedConfig) =>
      Effect.map(HttpClient.HttpClient, (httpClient) => makeClient(resolvedConfig, httpClient)),
    ),
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
export const layerFromEnv: Layer.Layer<InngestClient, ConfigError.ConfigError, HttpClient.HttpClient> = layerConfig(
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
