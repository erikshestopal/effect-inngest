import { Context, Effect, Layer, Option } from "effect";
import type { InngestFunction } from "../Function.js";
import { InngestClient } from "../Client.js";
import type { CheckpointConfig } from "./checkpoint.js";
import * as Protocol from "./protocol.js";
import type { HandlerContext } from "./runtime/HandlerContext.js";
import * as ExecutionScope from "./execution/ExecutionScope.js";
import * as HandlerRun from "./execution/HandlerRun.js";
import * as ExecutionResponse from "./execution/ExecutionResponse.js";
import { ExecutionResult } from "./execution/ExecutionResult.js";

export { ExecutionResult };

export const execute = <F extends InngestFunction.Any, R>(args: {
  readonly fn: F;
  readonly handler: (ctx: HandlerContext<F>) => Effect.Effect<InngestFunction.Success<F>, unknown, R>;
  readonly request: Protocol.SDKRequestBody;
  readonly checkpointConfig?: Option.Option<CheckpointConfig>;
}): Effect.Effect<ExecutionResult, never, R | InngestClient> =>
  HandlerRun.run({ fn: args.fn, handler: args.handler }).pipe(
    HandlerRun.withCheckpointDeadline,
    Effect.scoped,
    Effect.exit,
    Effect.flatMap(ExecutionResponse.fromExit),
    ExecutionScope.provide({ request: args.request, checkpointConfig: args.checkpointConfig ?? Option.none() }),
  );

export interface DriverService {
  readonly execute: typeof execute;
}

export class Driver extends Context.Service<Driver, DriverService>()("effect-inngest/Driver") {}

export const layer: Layer.Layer<Driver> = Layer.succeed(Driver, {
  execute,
});
