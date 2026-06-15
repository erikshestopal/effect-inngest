import { Effect } from "effect";
import type { InngestFunction } from "../../../Function.js";
import * as EventPayload from "../codec/EventPayload.js";
import type { ExecutionInput } from "../domain/ExecutionInput.js";
import { StepTools } from "./StepTools.js";

export interface HandlerContext<F extends InngestFunction.Any = InngestFunction.Any> {
  readonly event: InngestFunction.EventType<F>;
  readonly step: StepTools.Service;
  readonly run: ExecutionInput["run"];
}

export const make = <F extends InngestFunction.Any>(args: {
  readonly fn: F;
  readonly input: ExecutionInput;
}): Effect.Effect<HandlerContext<F>, EventPayload.EventDecodeError, StepTools> =>
  Effect.gen(function* () {
    const step = yield* StepTools;
    const event = yield* EventPayload.decodeInvocation(args);
    return { event, step, run: args.input.run };
  });
