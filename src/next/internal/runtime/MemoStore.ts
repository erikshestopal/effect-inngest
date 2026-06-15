import { Context, Layer, Match, Predicate, Schema } from "effect";

const IncomingMemo = Schema.Struct({
  data: Schema.optional(Schema.Unknown),
  error: Schema.optional(Schema.Unknown),
  input: Schema.optional(Schema.Unknown),
});
const IncomingMemoData = Schema.Struct({ data: Schema.Unknown });
const IncomingMemoError = Schema.Struct({ error: Schema.Unknown });
const IncomingMemoInput = Schema.Struct({ input: Schema.Unknown });

class MemoData extends Schema.TaggedClass<MemoData>()("MemoData", { data: Schema.Unknown }) {}
class MemoError extends Schema.TaggedClass<MemoError>()("MemoError", { error: Schema.Unknown }) {}
class MemoInput extends Schema.TaggedClass<MemoInput>()("MemoInput", { input: Schema.Unknown }) {}
class MemoTimeout extends Schema.TaggedClass<MemoTimeout>()("MemoTimeout", {}) {}
class MemoNone extends Schema.TaggedClass<MemoNone>()("MemoNone", {}) {}

export type Memo = MemoData | MemoError | MemoInput | MemoTimeout | MemoNone;

export const decode = (value: unknown): Memo =>
  Match.value(value).pipe(
    Match.when(Predicate.isNull, () => MemoTimeout.make({})),
    Match.when(Predicate.not(Schema.is(IncomingMemo)), () => MemoNone.make({})),
    Match.when(Schema.is(IncomingMemoError), ({ error }) => MemoError.make({ error })),
    Match.when(Schema.is(IncomingMemoInput), ({ input }) => MemoInput.make({ input })),
    Match.when(Schema.is(IncomingMemoData), ({ data }) => MemoData.make({ data })),
    Match.orElse(() => MemoNone.make({})),
  );

interface MemoStoreService {
  readonly get: (step: { readonly hash: string }) => Memo;
}

export const make = (steps: Readonly<Record<string, unknown>>): MemoStoreService => ({
  get: (step) => decode(steps[step.hash]),
});

export class MemoStore extends Context.Service<MemoStore, MemoStoreService>()(
  "effect-inngest/internal/runtime/MemoStore",
) {
  static readonly layer = (steps: Readonly<Record<string, unknown>>) => Layer.succeed(this, make(steps));
}
