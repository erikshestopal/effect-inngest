import { Context, Effect, Layer, Option } from "effect";
import type { InngestFunction } from "../../../Function.js";
import type { CheckpointState } from "../../../internal/checkpoint.js";
import * as EventPayload from "../codec/EventPayload.js";
import type { ExecutionInput } from "../domain/ExecutionInput.js";
import * as HandlerContext from "./HandlerContext.js";
import { StepTools } from "./StepTools.js";

export interface Service {
  readonly input: ExecutionInput;
  readonly handlerContext: <F extends InngestFunction.Any>(args: {
    readonly fn: F;
  }) => Effect.Effect<HandlerContext.HandlerContext<F>, EventPayload.EventDecodeError>;
}

export class ExecutionRuntime extends Context.Service<ExecutionRuntime, Service>()(
  "effect-inngest/internal/runtime/ExecutionRuntime",
) {
  static readonly layer = (args: {
    readonly input: ExecutionInput;
    readonly appName: string;
    readonly checkpoint: Option.Option<CheckpointState>;
  }) =>
    Layer.effect(
      this,
      Effect.gen(function* () {
        const step = yield* StepTools;

        return {
          input: args.input,
          handlerContext: ({ fn }) =>
            HandlerContext.make({ fn, input: args.input }).pipe(Effect.provideService(StepTools, step)),
        };
      }),
    ).pipe(Layer.provide(StepTools.layer(args)));
}
