import { Context, Effect, Layer } from "effect";
import { StepInterrupt } from "../../../internal/interrupts.js";
import type * as Protocol from "../../../internal/protocol.js";

export interface Service {
  readonly interrupt: (opcode: Protocol.GeneratorOpcode) => Effect.Effect<never>;
}

export class StepInterruptBoundary extends Context.Service<StepInterruptBoundary, Service>()(
  "effect-inngest/internal/runtime/StepInterruptBoundary",
) {
  static readonly layer = Layer.effect(
    this,
    Effect.succeed({
      interrupt: (opcode) => Effect.die(StepInterrupt.make({ opcode })),
    }),
  );
}
