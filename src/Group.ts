/**
 * @since 0.1.0
 */
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import type { InngestFunction } from "./Function.js";
import * as ServeHttp from "./internal/serve/http.js";

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
  F extends InngestFunction<infer Tag, infer _Triggers, infer _Success> ? Handler<Tag> : never;

/**
 * @since 0.1.0
 * @category models
 */
export interface InngestGroup<Fns extends InngestFunction.Any> {
  readonly [TypeId]: TypeId;
  readonly functions: ReadonlyMap<string, Fns>;

  /**
   * Implement all handlers for the functions in this group, returning a context object.
   */
  readonly toHandlers: <H extends HandlersFrom<Fns>>(
    handlers: H,
  ) => Effect.Effect<Context.Context<ToHandler<Fns>>, never, HandlersRequirements<H>>;

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

  /**
   * Retrieve a handler for a specific function in the group.
   */
  readonly accessHandler: <Tag extends InngestFunction.Tag<Fns>>(
    tag: Tag,
  ) => Effect.Effect<
    (
      context: HandlerContext<Extract<Fns, { readonly _tag: Tag }>>,
    ) => Effect.Effect<InngestFunction.Success<Extract<Fns, { readonly _tag: Tag }>>, unknown>,
    never,
    Handler<Tag>
  >;
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

  toHandlers(this: InngestGroup<InngestFunction.Any>, handlers: Record<string, unknown>) {
    const functions = this.functions;
    return Effect.gen(function* () {
      const context = yield* Effect.context<never>();
      const contextMap = new Map<string, unknown>();
      for (const [tag, handler] of Object.entries(handlers)) {
        const fn = functions.get(tag)!;
        contextMap.set(fn.key, { tag: fn._tag, handler, context });
      }
      return Context.makeUnsafe(contextMap);
    });
  },

  toLayer(this: InngestGroup<InngestFunction.Any>, handlers: Record<string, unknown>) {
    return Layer.effectContext(this.toHandlers(handlers as never));
  },

  toLayerHandler(this: InngestGroup<InngestFunction.Any>, tag: string, handler: unknown) {
    const fn = this.functions.get(tag)!;
    return Layer.effectContext(
      Effect.gen(function* () {
        const context = yield* Effect.context<never>();
        const contextMap = new Map<string, unknown>();
        contextMap.set(fn.key, { tag: fn._tag, handler, context });
        return Context.makeUnsafe(contextMap);
      }),
    );
  },

  accessHandler(this: InngestGroup<InngestFunction.Any>, tag: string) {
    return Effect.contextWith((parentContext: Context.Context<any>) => {
      const fn = this.functions.get(tag)!;
      const { handler, context } = parentContext.mapUnsafe.get(fn.key) as Handler<string>;
      return Effect.succeed((handlerContext: HandlerContext<any>) => Effect.provide(handler(handlerContext), context));
    });
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
  return group as InngestGroup<Fns[number]>;
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
export const toHttpApp = Effect.fn("InngestGroup.toHttpApp")(function* (group: InngestGroup.Any) {
  return yield* ServeHttp.toHttpApp(group);
});

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
export const toWebHandler = ServeHttp.toWebHandler;
