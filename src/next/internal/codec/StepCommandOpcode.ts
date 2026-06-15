import { Match } from "effect";
import * as Protocol from "../../../internal/protocol.js";
import * as StepCommand from "../domain/StepCommand.js";

export const yielded = (command: StepCommand.YieldCommand) =>
  Match.value(command).pipe(
    Match.tag("Sleep", (cmd) => Protocol.sleep(cmd.info, cmd.duration)),
    Match.tag("WaitForEvent", (cmd) =>
      Protocol.waitForEvent(cmd.info, { event: cmd.event, timeout: cmd.timeout, if: cmd.if }),
    ),
    Match.tag("InvokeFunction", (cmd) =>
      Protocol.invokeFunction(cmd.info, {
        function_id: cmd.functionId,
        payload: cmd.payload,
        timeout: cmd.timeout,
      }),
    ),
    Match.exhaustive,
  );

export const response = (command: StepCommand.ResultCommand) =>
  Match.value(command).pipe(
    Match.tag("StepRunResult", (cmd) => Protocol.stepRunResponse(cmd.info, cmd.data)),
    Match.tag("SendEventResult", (cmd) => Protocol.sendEventStepRunResponse(cmd.info, cmd.data)),
    Match.exhaustive,
  );

export const checkpointedResponse = (command: StepCommand.ResultCommand) =>
  Match.value(command).pipe(
    Match.tag("StepRunResult", (cmd) => Protocol.stepRun(cmd.info, cmd.data)),
    Match.tag("SendEventResult", (cmd) => Protocol.sendEventStepRun(cmd.info, cmd.data, cmd.rawPayload)),
    Match.exhaustive,
  );

export const planned = (command: StepCommand.PlanCommand) => ({
  opcode: Match.value(command).pipe(
    Match.tag("Sleep", (cmd) => Protocol.sleep(cmd.info, cmd.duration)),
    Match.tag("WaitForEvent", (cmd) =>
      Protocol.waitForEvent(cmd.info, { event: cmd.event, timeout: cmd.timeout, if: cmd.if }),
    ),
    Match.tag("InvokeFunction", (cmd) =>
      Protocol.invokeFunction(cmd.info, {
        function_id: cmd.functionId,
        payload: cmd.payload,
        timeout: cmd.timeout,
      }),
    ),
    Match.tag("StepRunPlanned", (cmd) => Protocol.stepPlanned(cmd.info)),
    Match.tag("SendEventPlanned", (cmd) => Protocol.sendEventStepPlanned(cmd.info)),
    Match.exhaustive,
  ),
  order: command.info.order,
});
