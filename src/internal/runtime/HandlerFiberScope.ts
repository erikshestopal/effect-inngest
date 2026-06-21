import { Context, Effect } from "effect";

export interface Service {
  readonly isForkedFromHandlerRoot: Effect.Effect<boolean>;
}

export class HandlerFiberScope extends Context.Service<HandlerFiberScope, Service>()(
  "effect-inngest/internal/runtime/HandlerFiberScope",
) {
  static readonly withRoot = <A, E, R>(effect: Effect.Effect<A, E, R>): Effect.Effect<A, E, R> =>
    Effect.gen(function* () {
      const rootFiberId = yield* Effect.fiberId;

      return yield* Effect.provideService(effect, HandlerFiberScope, {
        isForkedFromHandlerRoot: Effect.map(Effect.fiberId, (fiberId) => fiberId !== rootFiberId),
      });
    });
}
