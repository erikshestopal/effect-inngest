import { Match, Option, Schema } from "effect";
import * as Protocol from "../protocol.js";
import { StepInfo } from "./StepInfo.js";

export class Sleep extends Schema.TaggedClass<Sleep>()("Sleep", {
  info: StepInfo,
  sequence: Schema.Number,
  duration: Schema.String,
}) {}

export class WaitForEvent extends Schema.TaggedClass<WaitForEvent>()("WaitForEvent", {
  info: StepInfo,
  sequence: Schema.Number,
  event: Schema.String,
  timeout: Schema.String,
  if: Schema.optional(Schema.String),
}) {}

export class InvokeFunction extends Schema.TaggedClass<InvokeFunction>()("InvokeFunction", {
  info: StepInfo,
  sequence: Schema.Number,
  functionId: Schema.String,
  payload: Schema.Unknown,
  timeout: Schema.optional(Schema.String),
}) {}

export class StepRunResult extends Schema.TaggedClass<StepRunResult>()("StepRunResult", {
  info: StepInfo,
  data: Schema.Unknown,
}) {}

export class SendEventResult extends Schema.TaggedClass<SendEventResult>()("SendEventResult", {
  info: StepInfo,
  data: Schema.Struct({ ids: Schema.Array(Schema.String) }),
  rawPayload: Schema.Unknown,
}) {}

export class StepRunPlanned extends Schema.TaggedClass<StepRunPlanned>()("StepRunPlanned", {
  info: StepInfo,
  sequence: Schema.Number,
}) {}

export class SendEventPlanned extends Schema.TaggedClass<SendEventPlanned>()("SendEventPlanned", {
  info: StepInfo,
  sequence: Schema.Number,
}) {}

export class StepRunError extends Schema.TaggedClass<StepRunError>()("StepRunError", {
  info: StepInfo,
  error: Schema.Unknown,
  noRetry: Schema.optional(Schema.Boolean),
  retryAfterMs: Schema.optional(Schema.Number),
}) {}

export class StepRunFailed extends Schema.TaggedClass<StepRunFailed>()("StepRunFailed", {
  info: StepInfo,
  error: Schema.Unknown,
}) {}

export class Failure extends Schema.Class<Failure>("effect-inngest/internal/domain/StepCommand/Failure")({
  opcode: Protocol.GeneratorOpcode,
  retryAfterMs: Schema.Option(Schema.Number),
}) {}

export class PlannedOpcode extends Schema.Class<PlannedOpcode>(
  "effect-inngest/internal/domain/StepCommand/PlannedOpcode",
)({
  opcode: Protocol.GeneratorOpcode,
  sequence: Schema.Number,
}) {}

export type YieldCommand = Sleep | WaitForEvent | InvokeFunction;
export type ResultCommand = StepRunResult | SendEventResult;
export type PlanCommand = YieldCommand | StepRunPlanned | SendEventPlanned;
export type ErrorCommand = StepRunError | StepRunFailed;
export type StepCommand = YieldCommand | ResultCommand | PlanCommand | ErrorCommand;

export const suspension = (command: YieldCommand) =>
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

export const completion = (command: ResultCommand) =>
  Match.value(command).pipe(
    Match.tag("StepRunResult", (cmd) => Protocol.GeneratorOpcode.stepRunResponse({ info: cmd.info, data: cmd.data })),
    Match.tag("SendEventResult", (cmd) =>
      Protocol.GeneratorOpcode.sendEventStepRunResponse({ info: cmd.info, data: cmd.data }),
    ),
    Match.exhaustive,
  );

export const checkpoint = (command: ResultCommand) =>
  Match.value(command).pipe(
    Match.tag("StepRunResult", (cmd) => Protocol.GeneratorOpcode.stepRun({ info: cmd.info, data: cmd.data })),
    Match.tag("SendEventResult", (cmd) =>
      Protocol.GeneratorOpcode.sendEventStepRun({ info: cmd.info, data: cmd.data, rawPayload: cmd.rawPayload }),
    ),
    Match.exhaustive,
  );

export const plan = (command: PlanCommand) =>
  PlannedOpcode.make({
    opcode: Match.value(command).pipe(
      Match.tag("Sleep", (cmd) => suspension(cmd)),
      Match.tag("WaitForEvent", (cmd) => suspension(cmd)),
      Match.tag("InvokeFunction", (cmd) => suspension(cmd)),
      Match.tag("StepRunPlanned", (cmd) => Protocol.GeneratorOpcode.stepPlanned(cmd.info)),
      Match.tag("SendEventPlanned", (cmd) => Protocol.GeneratorOpcode.sendEventStepPlanned(cmd.info)),
      Match.exhaustive,
    ),
    sequence: command.sequence,
  });

export const failure = (command: ErrorCommand) =>
  Match.value(command).pipe(
    Match.tag("StepRunError", (cmd) =>
      Failure.make({
        opcode: Protocol.GeneratorOpcode.stepError({
          info: cmd.info,
          error: Protocol.UserError.fromUnknown(cmd.error),
          noRetry: cmd.noRetry,
        }),
        retryAfterMs: Option.fromNullishOr(cmd.retryAfterMs),
      }),
    ),
    Match.tag("StepRunFailed", (cmd) =>
      Failure.make({
        opcode: Protocol.GeneratorOpcode.stepFailed({
          info: cmd.info,
          error: Protocol.UserError.fromUnknown(cmd.error),
        }),
        retryAfterMs: Option.none<number>(),
      }),
    ),
    Match.exhaustive,
  );
