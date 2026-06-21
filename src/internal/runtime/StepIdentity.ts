import {
  Context,
  Effect,
  Option,
  Predicate,
  Layer,
  Number,
  Encoding,
  MutableHashMap,
  MutableRef,
  Schema,
} from "effect";
import type { StepInput } from "../domain/StepInput.js";
import { StepInfo } from "../domain/StepInfo.js";

export class StepReservation extends Schema.Class<StepReservation>("effect-inngest/internal/runtime/StepReservation")({
  id: Schema.String,
  name: Schema.String,
  effectiveId: Schema.String,
  order: Schema.Number,
  rawStepArg: Schema.Unknown,
}) {}

export class StepIdentity extends Context.Service<
  StepIdentity,
  {
    readonly reserve: (input: StepInput) => StepReservation;
    readonly resolve: (reservation: StepReservation) => Effect.Effect<StepInfo>;
  }
>()("effect-inngest/internal/runtime/StepIdentity", {
  make: Effect.gen(function* () {
    const counts = MutableHashMap.empty<string, number>();
    const order = MutableRef.make(0);
    const textEncoder = new TextEncoder();

    return {
      reserve: (input) => {
        const id = Predicate.isString(input) ? input : input.id;
        const name = Predicate.isString(input) ? input : (input.name ?? input.id);
        const currentOrder = MutableRef.getAndUpdate(order, Number.increment);
        const repeatIndex = Option.getOrElse(MutableHashMap.get(counts, id), () => 0);

        MutableHashMap.set(counts, id, Number.increment(repeatIndex));

        const effectiveId = repeatIndex > 0 ? `${id}:${repeatIndex}` : id;
        return StepReservation.make({ id, name, effectiveId, order: currentOrder, rawStepArg: input });
      },
      resolve: Effect.fnUntraced(function* (reservation) {
        const buffer = yield* Effect.promise(() =>
          globalThis.crypto.subtle.digest("SHA-1", textEncoder.encode(reservation.effectiveId)),
        );
        const hash = Encoding.encodeHex(new Uint8Array(buffer));

        return StepInfo.make({
          id: reservation.id,
          name: reservation.name,
          hash,
          order: reservation.order,
          rawStepArg: reservation.rawStepArg,
        });
      }),
    };
  }),
}) {
  static readonly layer = Layer.effect(this, this.make);
}

export { StepInfo };
