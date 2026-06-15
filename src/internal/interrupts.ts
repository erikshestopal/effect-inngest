/**
 * StepInterrupt schema and factory functions.
 * @internal
 */
import * as Predicate from "effect/Predicate";
import * as Schema from "effect/Schema";
import * as Protocol from "./protocol.js";

/** @internal */
export class StepInterrupt extends Schema.TaggedClass<StepInterrupt>()("StepInterrupt", {
  opcode: Protocol.GeneratorOpcode,
  retryAfterMs: Schema.optional(Schema.Number),
}) {}

/** @internal */
export interface StepInfo {
  readonly id: string;
  readonly name: string;
  readonly hash: string;
  readonly order?: number;
  readonly rawStepArg?: unknown;
}

const toUserError = (error: unknown): typeof Protocol.UserError.Type =>
  Protocol.UserError.make({
    name: Predicate.hasProperty(error, "name") ? String(error.name) : "Error",
    message: Predicate.hasProperty(error, "message") ? String(error.message) : String(error),
    stack: Predicate.hasProperty(error, "stack") ? String(error.stack) : undefined,
  });

/** @internal */
export const sleepInterrupt = (opts: { info: StepInfo; duration: string }) =>
  StepInterrupt.make({ opcode: Protocol.sleep(opts.info, opts.duration) });

/** @internal */
export const waitForEventInterrupt = (opts: { info: StepInfo; event: string; timeout: string; if?: string }) =>
  StepInterrupt.make({
    opcode: Protocol.waitForEvent(opts.info, { event: opts.event, timeout: opts.timeout, if: opts.if }),
  });

/** @internal */
export const invokeInterrupt = (opts: { info: StepInfo; functionId: string; payload: unknown; timeout?: string }) =>
  StepInterrupt.make({
    opcode: Protocol.invokeFunction(opts.info, {
      function_id: opts.functionId,
      payload: opts.payload,
      timeout: opts.timeout,
    }),
  });

/** @internal */
export const plannedInterrupt = (opts: { info: StepInfo }) =>
  StepInterrupt.make({ opcode: Protocol.stepPlanned(opts.info) });

/** @internal */
export const runInterrupt = (opts: { info: StepInfo; data: unknown }) =>
  StepInterrupt.make({ opcode: Protocol.stepRunResponse(opts.info, opts.data) });

/** @internal */
export const errorInterrupt = (opts: { info: StepInfo; error: unknown; noRetry?: boolean; retryAfterMs?: number }) =>
  StepInterrupt.make({
    opcode: Protocol.stepError(opts.info, toUserError(opts.error), opts.noRetry),
    retryAfterMs: opts.retryAfterMs,
  });

/** @internal */
export const failedInterrupt = (opts: { info: StepInfo; error: unknown }) =>
  StepInterrupt.make({ opcode: Protocol.stepFailed(opts.info, toUserError(opts.error)) });
