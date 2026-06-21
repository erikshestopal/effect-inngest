import { Match, Option } from "effect";
import * as Protocol from "../protocol.js";
import * as StepCommand from "../domain/StepCommand.js";

export const yielded = (command: StepCommand.YieldCommand) =>
  Match.value(command).pipe(
    Match.tag("Sleep", (cmd) => Protocol.GeneratorOpcode.sleep({ info: cmd.info, duration: cmd.duration })),
    Match.tag("WaitForEvent", (cmd) =>
      Protocol.GeneratorOpcode.waitForEvent({ info: cmd.info, event: cmd.event, timeout: cmd.timeout, if: cmd.if }),
    ),
    Match.tag("InvokeFunction", (cmd) =>
      Protocol.GeneratorOpcode.invokeFunction({
        info: cmd.info,
        functionId: cmd.functionId,
        payload: cmd.payload,
        timeout: cmd.timeout,
      }),
    ),
    Match.exhaustive,
  );

export const response = (command: StepCommand.ResultCommand) =>
  Match.value(command).pipe(
    Match.tag("StepRunResult", (cmd) => Protocol.GeneratorOpcode.stepRunResponse({ info: cmd.info, data: cmd.data })),
    Match.tag("SendEventResult", (cmd) =>
      Protocol.GeneratorOpcode.sendEventStepRunResponse({ info: cmd.info, data: cmd.data }),
    ),
    Match.exhaustive,
  );

export const checkpointedResponse = (command: StepCommand.ResultCommand) =>
  Match.value(command).pipe(
    Match.tag("StepRunResult", (cmd) => Protocol.GeneratorOpcode.stepRun({ info: cmd.info, data: cmd.data })),
    Match.tag("SendEventResult", (cmd) =>
      Protocol.GeneratorOpcode.sendEventStepRun({ info: cmd.info, data: cmd.data, rawPayload: cmd.rawPayload }),
    ),
    Match.exhaustive,
  );

export const planned = (command: StepCommand.PlanCommand) => ({
  opcode: Match.value(command).pipe(
    Match.tag("Sleep", (cmd) => Protocol.GeneratorOpcode.sleep({ info: cmd.info, duration: cmd.duration })),
    Match.tag("WaitForEvent", (cmd) =>
      Protocol.GeneratorOpcode.waitForEvent({ info: cmd.info, event: cmd.event, timeout: cmd.timeout, if: cmd.if }),
    ),
    Match.tag("InvokeFunction", (cmd) =>
      Protocol.GeneratorOpcode.invokeFunction({
        info: cmd.info,
        functionId: cmd.functionId,
        payload: cmd.payload,
        timeout: cmd.timeout,
      }),
    ),
    Match.tag("StepRunPlanned", (cmd) => Protocol.GeneratorOpcode.stepPlanned(cmd.info)),
    Match.tag("SendEventPlanned", (cmd) => Protocol.GeneratorOpcode.sendEventStepPlanned(cmd.info)),
    Match.exhaustive,
  ),
  order: command.info.order,
});

export const failure = (command: StepCommand.ErrorCommand) =>
  Match.value(command).pipe(
    Match.tag("StepRunError", (cmd) => ({
      opcode: Protocol.GeneratorOpcode.stepError({
        info: cmd.info,
        error: Protocol.UserError.fromUnknown(cmd.error),
        noRetry: cmd.noRetry,
      }),
      retryAfterMs: Option.fromNullishOr(cmd.retryAfterMs),
    })),
    Match.tag("StepRunFailed", (cmd) => ({
      opcode: Protocol.GeneratorOpcode.stepFailed({ info: cmd.info, error: Protocol.UserError.fromUnknown(cmd.error) }),
      retryAfterMs: Option.none<number>(),
    })),
    Match.exhaustive,
  );
