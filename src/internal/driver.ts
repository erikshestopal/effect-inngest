/**
 * Driver execution facade.
 * @internal
 */
import { Context, Effect, Layer, Option } from "effect";
import type { InngestFunction } from "../Function.js";
import { InngestClient } from "../Client.js";
import type { CheckpointConfig } from "./checkpoint.js";
import * as Protocol from "./protocol.js";
import type { HandlerContext } from "../next/internal/runtime/HandlerContext.js";
import * as ExecutionScope from "./execution/ExecutionScope.js";
import * as HandlerRun from "./execution/HandlerRun.js";
import * as ExecutionResponse from "./execution/ExecutionResponse.js";
import { ExecutionResult } from "./execution/ExecutionResult.js";

export { ExecutionResult };

export const execute = <F extends InngestFunction.Any, R>(
  fn: F,
  handler: (ctx: HandlerContext<F>) => Effect.Effect<InngestFunction.Success<F>, unknown, R>,
  request: Protocol.SDKRequestBody,
  checkpointConfig: Option.Option<CheckpointConfig> = Option.none(),
): Effect.Effect<ExecutionResult, never, R | InngestClient> =>
  HandlerRun.run({ fn, handler }).pipe(
    HandlerRun.withCheckpointDeadline,
    Effect.scoped,
    Effect.exit,
    Effect.flatMap(ExecutionResponse.fromExit),
    ExecutionScope.provide({ request, checkpointConfig }),
  );

export interface DriverService {
  readonly execute: <F extends InngestFunction.Any, R>(
    fn: F,
    handler: (ctx: HandlerContext<F>) => Effect.Effect<InngestFunction.Success<F>, unknown, R>,
    request: Protocol.SDKRequestBody,
    checkpointConfig?: Option.Option<CheckpointConfig>,
  ) => Effect.Effect<ExecutionResult, never, R | InngestClient>;
}

export class Driver extends Context.Service<Driver, DriverService>()("effect-inngest/Driver") {}

export const layer: Layer.Layer<Driver> = Layer.succeed(Driver, {
  execute: <F extends InngestFunction.Any, R>(
    fn: F,
    handler: (ctx: HandlerContext<F>) => Effect.Effect<InngestFunction.Success<F>, unknown, R>,
    request: Protocol.SDKRequestBody,
    checkpointConfig: Option.Option<CheckpointConfig> = Option.none(),
  ) => execute(fn, handler, request, checkpointConfig),
});
