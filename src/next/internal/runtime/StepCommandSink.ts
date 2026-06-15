import { Context, Effect, Layer, Match, Option } from "effect";
import type { CheckpointState } from "../../../internal/checkpoint.js";
import * as StepCommandOpcode from "../codec/StepCommandOpcode.js";
import * as StepCommand from "../domain/StepCommand.js";
import { StepInterruptBoundary } from "./StepInterruptBoundary.js";

export interface Service {
  readonly submit: (command: StepCommand.StepCommand) => Effect.Effect<void>;
}

export class StepCommandSink extends Context.Service<StepCommandSink, Service>()(
  "effect-inngest/internal/runtime/StepCommandSink",
) {
  static readonly layer = (args: { readonly checkpoint: Option.Option<CheckpointState> }) =>
    Layer.effect(
      this,
      Effect.gen(function* () {
        const boundary = yield* StepInterruptBoundary;

        return {
          submit: (command) =>
            Match.value(command).pipe(
              Match.tag("Sleep", "WaitForEvent", "InvokeFunction", (cmd) =>
                Option.match(args.checkpoint, {
                  onNone: () => boundary.interrupt(StepCommandOpcode.interrupt(cmd)),
                  onSome: (state) => Effect.andThen(state.flush, boundary.interrupt(StepCommandOpcode.interrupt(cmd))),
                }),
              ),
              Match.tag("StepRunResult", "SendEventResult", (cmd) =>
                Option.match(args.checkpoint, {
                  onNone: () => boundary.interrupt(StepCommandOpcode.response(cmd)),
                  onSome: (state) => state.bufferStep(StepCommandOpcode.checkpointedResponse(cmd)),
                }),
              ),
              Match.tag("StepPlanned", (cmd) =>
                Option.match(args.checkpoint, {
                  onNone: () => boundary.interrupt(StepCommandOpcode.planned(cmd).opcode),
                  onSome: (state) => {
                    const planned = StepCommandOpcode.planned(cmd);
                    return state.planOpcode(planned.opcode, planned.order);
                  },
                }),
              ),
              Match.exhaustive,
            ),
        };
      }),
    ).pipe(Layer.provide(StepInterruptBoundary.layer));
}
