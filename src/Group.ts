/**
 * @since 0.1.0
 */
import * as HttpClient from "effect/unstable/http/HttpClient";
import * as HttpEffect from "effect/unstable/http/HttpEffect";
import * as HttpServerRequest from "effect/unstable/http/HttpServerRequest";
import * as HttpServerResponse from "effect/unstable/http/HttpServerResponse";
import * as UrlParams from "effect/unstable/http/UrlParams";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import type { InngestFunction } from "./Function.js";
import { InngestClient } from "./Client.js";
import * as InternalHandler from "./internal/handler.js";
import * as Protocol from "./internal/protocol.js";
import { SignatureLive } from "./internal/signature.js";

import { type HandlerContext } from "./internal/step.js";

/**
 * Re-export HandlerContext from internal step module.
 * @since 0.1.0
 * @category models
 */
export { type HandlerContext };

/**
 * @since 0.1.0
 * @category type ids
 */
export const TypeId: unique symbol = Symbol.for("effect-inngest/Group");

/**
 * @since 0.1.0
 * @category type ids
 */
export type TypeId = typeof TypeId;

/**
 * @since 0.1.0
 * @category models
 */
export type HandlerFn<F extends InngestFunction.Any> = (
  context: HandlerContext<F>,
) => Effect.Effect<InngestFunction.Success<F>, unknown, unknown>;

/**
 * @since 0.1.0
 * @category models
 */
export type HandlersFrom<Fns extends InngestFunction.Any> = {
  readonly [F in Fns as InngestFunction.Tag<F>]: HandlerFn<F>;
};

/**
 * @since 0.1.0
 * @category models
 */
export type HandlerFrom<Fns extends InngestFunction.Any, Tag extends InngestFunction.Tag<Fns>> =
  Extract<Fns, { readonly _tag: Tag }> extends infer Current
    ? Current extends InngestFunction.Any
      ? HandlerFn<Current>
      : never
    : never;

/**
 * @since 0.1.0
 * @category models
 */
export type HandlersRequirements<H> =
  H extends Record<string, (...args: ReadonlyArray<unknown>) => Effect.Effect<unknown, unknown, infer R>> ? R : never;

/**
 * @since 0.1.0
 * @category models
 */
export type HandlerRequirements<Handler> = Handler extends (
  ...args: ReadonlyArray<unknown>
) => Effect.Effect<unknown, unknown, infer R>
  ? R
  : never;

/**
 * A nominal type representing a registered handler for a specific function tag.
 * @since 0.1.0
 * @category models
 */
export interface Handler<Tag extends string> {
  readonly _: unique symbol;
  readonly tag: Tag;
  readonly handler: (context: unknown) => Effect.Effect<unknown, unknown, unknown>;
  readonly context: Context.Context<never>;
}

/**
 * Maps a function to its Handler type.
 * @since 0.1.0
 * @category models
 */
export type ToHandler<F extends InngestFunction.Any> =
  F extends InngestFunction<infer _Tag, infer _Triggers, infer _Success> ? Handler<_Tag> : never;

/**
 * @since 0.1.0
 * @category models
 */
export interface InngestGroup<Fns extends InngestFunction.Any> {
  readonly [TypeId]: TypeId;
  readonly functions: ReadonlyMap<string, Fns>;

  /**
   * Implement all handlers for the functions in this group.
   */
  readonly toLayer: <H extends HandlersFrom<Fns>>(
    handlers: H,
  ) => Layer.Layer<ToHandler<Fns>, never, HandlersRequirements<H>>;

  /**
   * Implement a single handler from the group.
   */
  readonly toLayerHandler: <Tag extends InngestFunction.Tag<Fns>, H extends HandlerFrom<Fns, Tag>>(
    tag: Tag,
    handler: H,
  ) => Layer.Layer<Handler<Tag>, never, HandlerRequirements<H>>;
}

/**
 * @since 0.1.0
 * @category models
 */
export declare namespace InngestGroup {
  export type Any = InngestGroup<InngestFunction.Any>;
  export type Functions<G> = G extends InngestGroup<infer Fns> ? Fns : never;
  export type FunctionTags<G> = G extends InngestGroup<infer Fns> ? InngestFunction.Tag<Fns> : never;
  export type Handlers<G> = G extends InngestGroup<infer Fns> ? HandlersFrom<Fns> : never;
}

const Proto = {
  [TypeId]: TypeId,

  toLayer(this: InngestGroup<InngestFunction.Any>, handlers: Record<string, unknown>) {
    const functions = this.functions;
    return Layer.effectContext(
      Effect.gen(function* () {
        const context = yield* Effect.context<never>();
        const contextMap = new Map<string, unknown>();
        for (const [tag, handler] of Object.entries(handlers)) {
          const fn = functions.get(tag)!;
          contextMap.set(fn.key, { handler, context });
        }
        return Context.makeUnsafe(contextMap);
      }),
    );
  },

  toLayerHandler(this: InngestGroup<InngestFunction.Any>, tag: string, handler: unknown) {
    const fn = this.functions.get(tag)!;
    return Layer.effectContext(
      Effect.gen(function* () {
        const context = yield* Effect.context<never>();
        const contextMap = new Map<string, unknown>();
        contextMap.set(fn.key, { handler, context });
        return Context.makeUnsafe(contextMap);
      }),
    );
  },
};

/**
 * @since 0.1.0
 * @category constructors
 */
export const make = <Fns extends ReadonlyArray<InngestFunction.Any>>(...fns: Fns): InngestGroup<Fns[number]> => {
  const functions = new Map(fns.map((fn) => [fn._tag, fn]));
  const group = Object.create(Proto);
  group.functions = functions;
  return group;
};

/**
 * Build an HttpApp from an InngestGroup.
 *
 * @since 0.1.0
 * @category http
 * @example
 * ```ts
 * import { Effect, Layer } from "effect"
 * import { HttpServer } from "@effect/platform"
 * import { NodeHttpServer, NodeRuntime } from "@effect/platform-node"
 * import { InngestGroup, InngestClient } from "effect-inngest"
 *
 * InngestGroup.toHttpApp(MyGroup).pipe(
 *   Effect.flatMap((app) => HttpServer.serve(app)),
 *   Effect.provide(InngestClient.layer({ id: "my-app" })),
 *   Effect.provide(NodeHttpServer.layer({ port: 3000 })),
 *   NodeRuntime.runMain,
 * )
 * ```
 */
export const toHttpApp = (
  group: InngestGroup.Any,
): Effect.Effect<
  HttpServerResponse.HttpServerResponse,
  never,
  HttpServerRequest.HttpServerRequest | InngestClient | HttpClient.HttpClient
> =>
  Effect.gen(function* () {
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
      const url = Option.getOrThrow(HttpServerRequest.toURL(request));

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
  }).pipe(
    Effect.catchCause((cause) =>
      HttpServerResponse.json({ error: "Internal server error", cause: String(cause) }, { status: 500 }).pipe(
        Effect.orDie,
      ),
    ),
  );

/**
 * Create a standalone web handler from an InngestGroup.
 *
 * @since 0.1.0
 * @category http
 * @example
 * ```ts
 * import { InngestGroup, InngestClient } from "effect-inngest"
 * import { HttpClient } from "@effect/platform"
 * import { FetchHttpClient } from "@effect/platform"
 *
 * const { handler, dispose } = InngestGroup.toWebHandler(MyGroup, {
 *   layer: InngestClient.layer({ id: "my-app" }).pipe(
 *     Layer.provide(FetchHttpClient.layer),
 *   ),
 * })
 *
 * // Use with any web framework
 * Bun.serve({ fetch: handler, port: 3000 })
 *
 * // Call dispose() on shutdown
 * process.on("SIGTERM", dispose)
 * ```
 */
export const toWebHandler = <R, E>(
  group: InngestGroup.Any,
  options: {
    readonly layer: Layer.Layer<InngestClient | HttpClient.HttpClient | R, E, never>;
  },
): {
  readonly handler: (request: Request, context?: Context.Context<never>) => Promise<Response>;
  readonly dispose: () => Promise<void>;
} => HttpEffect.toWebHandlerLayer(toHttpApp(group), options.layer);
