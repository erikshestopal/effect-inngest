import { Context, Effect, Layer } from "effect";
import type { InngestFunction } from "../../../Function.js";
import * as EventPayload from "../codec/EventPayload.js";
import { CurrentExecutionInput, type ExecutionInput } from "../domain/ExecutionInput.js";
import * as HandlerContext from "./HandlerContext.js";
import { StepTools } from "./StepTools.js";

export interface Service {
  readonly input: ExecutionInput;
  readonly step: StepTools.Service;
  readonly handlerContext: <F extends InngestFunction.Any>(args: {
    readonly fn: F;
  }) => Effect.Effect<HandlerContext.HandlerContext<F>, EventPayload.EventDecodeError>;
}

export class ExecutionRuntime extends Context.Service<ExecutionRuntime, Service>()(
  "effect-inngest/internal/runtime/ExecutionRuntime",
) {
  static readonly layer = Layer.effect(
    this,
    Effect.gen(function* () {
      const input = yield* CurrentExecutionInput;
      const tools = yield* StepTools;

      return {
        input,
        step: tools,
        handlerContext: ({ fn }) =>
          HandlerContext.make({ fn }).pipe(
            Effect.provideService(CurrentExecutionInput, input),
            Effect.provideService(StepTools, tools),
          ),
      };
    }),
  ).pipe(Layer.provide(StepTools.layer));
}
