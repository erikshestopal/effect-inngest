import { Match } from "effect";
import * as Protocol from "../../../internal/protocol.js";
import * as StepCommand from "../domain/StepCommand.js";

export const interrupt = (command: StepCommand.Sleep | StepCommand.WaitForEvent | StepCommand.InvokeFunction) =>
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

export const response = (command: StepCommand.StepRunResult | StepCommand.SendEventResult) =>
  Match.value(command).pipe(
    Match.tag("StepRunResult", (cmd) => Protocol.stepRunResponse(cmd.info, cmd.data)),
    Match.tag("SendEventResult", (cmd) => Protocol.sendEventStepRunResponse(cmd.info, cmd.data)),
    Match.exhaustive,
  );

export const checkpointedResponse = (command: StepCommand.StepRunResult | StepCommand.SendEventResult) =>
  Match.value(command).pipe(
    Match.tag("StepRunResult", (cmd) => Protocol.stepRun(cmd.info, cmd.data)),
    Match.tag("SendEventResult", (cmd) => Protocol.sendEventStepRun(cmd.info, cmd.data, cmd.rawPayload)),
    Match.exhaustive,
  );

export const planned = (command: StepCommand.StepPlanned) => ({
  opcode: Match.value(command.kind).pipe(
    Match.when("sendEvent", () => Protocol.sendEventStepPlanned(command.info)),
    Match.when("run", () => Protocol.stepPlanned(command.info)),
    Match.exhaustive,
  ),
  order: command.info.order,
});
