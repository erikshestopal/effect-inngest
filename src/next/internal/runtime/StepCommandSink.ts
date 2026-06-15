import { Context, Effect, Layer, Option } from "effect";
import * as StepCommandOpcode from "../codec/StepCommandOpcode.js";
import * as StepCommand from "../domain/StepCommand.js";
import { CurrentCheckpoint } from "./CheckpointContext.js";
import { StepInterruptBoundary } from "./StepInterruptBoundary.js";

export interface Service {
  readonly yieldCommand: (command: StepCommand.YieldCommand) => Effect.Effect<void>;
  readonly recordResult: (command: StepCommand.ResultCommand) => Effect.Effect<void>;
  readonly planCommand: (command: StepCommand.PlanCommand) => Effect.Effect<void>;
}

export class StepCommandSink extends Context.Service<StepCommandSink, Service>()(
  "effect-inngest/internal/runtime/StepCommandSink",
) {
  static readonly layer = Layer.effect(
    this,
    Effect.gen(function* () {
      const boundary = yield* StepInterruptBoundary;

      return {
        yieldCommand: (command) =>
          Effect.gen(function* () {
            const checkpoint = yield* CurrentCheckpoint;
            if (Option.isSome(checkpoint)) {
              yield* checkpoint.value.flush;
            }
            return yield* boundary.interrupt(StepCommandOpcode.yielded(command));
          }),
        recordResult: (command) =>
          Effect.gen(function* () {
            const checkpoint = yield* CurrentCheckpoint;
            if (Option.isNone(checkpoint)) {
              return yield* boundary.interrupt(StepCommandOpcode.response(command));
            }
            return yield* checkpoint.value.bufferStep(StepCommandOpcode.checkpointedResponse(command));
          }),
        planCommand: (command) =>
          Effect.gen(function* () {
            const checkpoint = yield* CurrentCheckpoint;
            const planned = StepCommandOpcode.planned(command);
            if (Option.isNone(checkpoint)) {
              return yield* boundary.interrupt(planned.opcode);
            }
            return yield* checkpoint.value.planOpcode(planned.opcode, planned.order);
          }),
      };
    }),
  ).pipe(Layer.provide(StepInterruptBoundary.layer));
}
