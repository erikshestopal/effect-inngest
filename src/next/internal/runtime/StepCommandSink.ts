import { Context, Effect, Layer, Match, Option } from "effect";
import type { CheckpointState } from "../../../internal/checkpoint.js";
import * as Protocol from "../../../internal/protocol.js";
import { StepInterrupt } from "../../../internal/interrupts.js";
import * as StepCommand from "../domain/StepCommand.js";

export interface Service {
  readonly submit: (command: StepCommand.StepCommand) => Effect.Effect<void>;
}

export class StepCommandSink extends Context.Service<StepCommandSink, Service>()(
  "effect-inngest/internal/runtime/StepCommandSink",
) {
  static readonly layer = (args: { readonly checkpoint: Option.Option<CheckpointState> }) =>
    Layer.succeed(this, {
      submit: (command) =>
        Match.value(command).pipe(
          Match.tag("Sleep", (cmd) =>
            Option.match(args.checkpoint, {
              onNone: () => Effect.die(StepInterrupt.make({ opcode: Protocol.sleep(cmd.info, cmd.duration) })),
              onSome: (state) =>
                Effect.andThen(
                  state.flush,
                  Effect.die(StepInterrupt.make({ opcode: Protocol.sleep(cmd.info, cmd.duration) })),
                ),
            }),
          ),
          Match.tag("WaitForEvent", (cmd) =>
            Option.match(args.checkpoint, {
              onNone: () =>
                Effect.die(
                  StepInterrupt.make({
                    opcode: Protocol.waitForEvent(cmd.info, {
                      event: cmd.event,
                      timeout: cmd.timeout,
                      if: cmd.if,
                    }),
                  }),
                ),
              onSome: (state) =>
                Effect.andThen(
                  state.flush,
                  Effect.die(
                    StepInterrupt.make({
                      opcode: Protocol.waitForEvent(cmd.info, {
                        event: cmd.event,
                        timeout: cmd.timeout,
                        if: cmd.if,
                      }),
                    }),
                  ),
                ),
            }),
          ),
          Match.tag("InvokeFunction", (cmd) =>
            Option.match(args.checkpoint, {
              onNone: () =>
                Effect.die(
                  StepInterrupt.make({
                    opcode: Protocol.invokeFunction(cmd.info, {
                      function_id: cmd.functionId,
                      payload: cmd.payload,
                      timeout: cmd.timeout,
                    }),
                  }),
                ),
              onSome: (state) =>
                Effect.andThen(
                  state.flush,
                  Effect.die(
                    StepInterrupt.make({
                      opcode: Protocol.invokeFunction(cmd.info, {
                        function_id: cmd.functionId,
                        payload: cmd.payload,
                        timeout: cmd.timeout,
                      }),
                    }),
                  ),
                ),
            }),
          ),
          Match.tag("StepRunResult", (cmd) =>
            Option.match(args.checkpoint, {
              onNone: () => Effect.die(StepInterrupt.make({ opcode: Protocol.stepRunResponse(cmd.info, cmd.data) })),
              onSome: (state) => state.bufferStep(Protocol.stepRun(cmd.info, cmd.data)),
            }),
          ),
          Match.tag("SendEventResult", (cmd) =>
            Option.match(args.checkpoint, {
              onNone: () =>
                Effect.die(StepInterrupt.make({ opcode: Protocol.sendEventStepRunResponse(cmd.info, cmd.data) })),
              onSome: (state) => state.bufferStep(Protocol.sendEventStepRun(cmd.info, cmd.data, cmd.rawPayload)),
            }),
          ),
          Match.tag("StepPlanned", (cmd) =>
            Option.match(args.checkpoint, {
              onNone: () => Effect.die(StepInterrupt.make({ opcode: Protocol.stepPlanned(cmd.info) })),
              onSome: (state) =>
                state.planOpcode(
                  cmd.kind === "sendEvent" ? Protocol.sendEventStepPlanned(cmd.info) : Protocol.stepPlanned(cmd.info),
                  cmd.info.order,
                ),
            }),
          ),
          Match.exhaustive,
        ),
    });
}
