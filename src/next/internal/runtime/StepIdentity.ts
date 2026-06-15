import { Context, Effect, Option, Predicate, Ref, Schema, Layer, Number, Encoding, MutableHashMap } from "effect";

const StepOptions = Schema.Struct({ id: Schema.String, name: Schema.optional(Schema.String) });
const StepInput = Schema.Union([Schema.String, StepOptions]);

export const StepInfo = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  hash: Schema.String,
  order: Schema.Number,
  rawStepArg: Schema.Unknown,
});

type StepInput = typeof StepInput.Type;
export type StepInfo = typeof StepInfo.Type;

export class StepIdentity extends Context.Service<
  StepIdentity,
  {
    readonly resolve: (input: StepInput) => Effect.Effect<StepInfo>;
  }
>()("effect-inngest/internal/runtime/StepIdentity", {
  make: Effect.gen(function* () {
    const counts = MutableHashMap.empty<string, number>();
    const order = yield* Ref.make(0);
    const textEncoder = new TextEncoder();

    return {
      resolve: Effect.fnUntraced(function* (input) {
        const id = Predicate.isString(input) ? input : input.id;
        const name = Predicate.isString(input) ? input : (input.name ?? input.id);
        const currentOrder = yield* Ref.getAndUpdate(order, Number.increment);
        const repeatIndex = Option.getOrElse(MutableHashMap.get(counts, id), () => 0);

        MutableHashMap.set(counts, id, Number.increment(repeatIndex));

        const effectiveId = repeatIndex > 0 ? `${id}:${repeatIndex}` : id;
        const buffer = yield* Effect.promise(() =>
          globalThis.crypto.subtle.digest("SHA-1", textEncoder.encode(effectiveId)),
        );
        const hash = Encoding.encodeHex(new Uint8Array(buffer));

        return StepInfo.make({ id, name, hash, order: currentOrder, rawStepArg: input });
      }),
    };
  }),
}) {
  static readonly layer = Layer.effect(this, this.make);
}
