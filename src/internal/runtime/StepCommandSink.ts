import { Context, Effect, Layer, Option, Ref, Schema } from "effect";
import * as Protocol from "../protocol.js";
import * as StepCommandOpcode from "../codec/StepCommandOpcode.js";
import * as StepCommand from "../domain/StepCommand.js";
import { CurrentCheckpoint } from "./CheckpointContext.js";

export class StepYield extends Schema.Class<StepYield>("effect-inngest/internal/runtime/StepYield")({
  opcode: Protocol.GeneratorOpcode,
  retryAfterMs: Schema.Option(Schema.Number),
}) {}

export interface Service {
  readonly yieldCommand: (command: StepCommand.YieldCommand) => Effect.Effect<void>;
  readonly recordResult: (command: StepCommand.ResultCommand) => Effect.Effect<void>;
  readonly planCommand: (command: StepCommand.PlanCommand) => Effect.Effect<void>;
  readonly failCommand: (command: StepCommand.ErrorCommand) => Effect.Effect<void>;
  readonly takeYields: Effect.Effect<ReadonlyArray<StepYield>>;
}

export class StepCommandSink extends Context.Service<StepCommandSink, Service>()(
  "effect-inngest/internal/runtime/StepCommandSink",
) {
  static readonly make = Effect.gen(function* () {
    const yields = yield* Ref.make<Array<StepYield>>([]);

    const suspend = (args: {
      readonly opcode: typeof Protocol.GeneratorOpcode.Type;
      readonly retryAfterMs?: Option.Option<number>;
    }) =>
      Ref.update((current: Array<StepYield>) => [
        ...current,
        StepYield.make({ opcode: args.opcode, retryAfterMs: args.retryAfterMs ?? Option.none() }),
      ])(yields).pipe(Effect.andThen(Effect.interrupt));

    return {
      yieldCommand: (command: StepCommand.YieldCommand) =>
        Effect.gen(function* () {
          const checkpoint = yield* CurrentCheckpoint;
          if (Option.isSome(checkpoint)) {
            yield* checkpoint.value.flush;
          }
          return yield* suspend({ opcode: StepCommandOpcode.yielded(command) });
        }),
      recordResult: (command: StepCommand.ResultCommand) =>
        Effect.gen(function* () {
          const checkpoint = yield* CurrentCheckpoint;
          if (Option.isNone(checkpoint)) {
            return yield* suspend({ opcode: StepCommandOpcode.response(command) });
          }
          return yield* checkpoint.value.bufferStep(StepCommandOpcode.checkpointedResponse(command));
        }),
      planCommand: (command: StepCommand.PlanCommand) =>
        Effect.gen(function* () {
          const checkpoint = yield* CurrentCheckpoint;
          const planned = StepCommandOpcode.planned(command);
          if (Option.isNone(checkpoint)) {
            return yield* suspend({ opcode: planned.opcode });
          }
          return yield* checkpoint.value.planOpcode(planned.opcode, planned.order);
        }),
      failCommand: (command: StepCommand.ErrorCommand) => {
        const failed = StepCommandOpcode.failure(command);
        return suspend({ opcode: failed.opcode, retryAfterMs: failed.retryAfterMs });
      },
      takeYields: Ref.modify(yields, (current) => [current, [] as Array<StepYield>]),
    };
  });

  static readonly layer = Layer.effect(this, this.make);
}
