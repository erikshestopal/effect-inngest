import { Context, Effect } from "effect";

export interface Service {
  readonly isForkedFromHandlerRoot: Effect.Effect<boolean>;
}

export class HandlerFiberScope extends Context.Service<HandlerFiberScope, Service>()(
  "effect-inngest/internal/runtime/HandlerFiberScope",
) {}
