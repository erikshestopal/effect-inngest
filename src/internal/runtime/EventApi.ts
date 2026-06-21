import { Context, Effect, Layer } from "effect";
import { InngestClient } from "../../Client.js";
import type { SendEventError } from "../errors.js";

export interface OutgoingEvent {
  readonly name: string;
  readonly data: unknown;
}

export interface Service {
  readonly send: (
    events: ReadonlyArray<OutgoingEvent>,
  ) => Effect.Effect<{ readonly ids: ReadonlyArray<string> }, SendEventError, InngestClient>;
}

export class EventApi extends Context.Service<EventApi, Service>()("effect-inngest/internal/runtime/EventApi", {
  make: Effect.succeed({
    send: (events) => InngestClient.use((client) => client.sendEvent(events)),
  }),
}) {
  static readonly layer = Layer.effect(this, this.make);
}
