import { Clock, Context, Effect, Option } from "effect";
import { InngestClient, InngestConfig } from "../../Client.js";
import * as CheckpointRun from "./CheckpointRun.js";
import type { CheckpointConfig } from "../checkpoint.js";
import * as Protocol from "../protocol.js";
import { CurrentExecutionInput, ExecutionInput } from "../domain/ExecutionInput.js";
import { CurrentCheckpoint } from "../runtime/CheckpointContext.js";
import { HandlerFiberScope } from "../runtime/HandlerFiberScope.js";
import { StepCommandBus } from "../runtime/StepCommandBus.js";
import { StepIdentity } from "../runtime/StepIdentity.js";
import { StepTools } from "../runtime/StepTools.js";

export const provide =
  (args: { readonly request: Protocol.SDKRequestBody; readonly checkpointConfig: Option.Option<CheckpointConfig> }) =>
  <A, E, R>(effect: Effect.Effect<A, E, R>) =>
    Effect.gen(function* () {
      const client = yield* InngestClient;
      const rootFiberId = yield* Effect.fiberId;
      const requestStartedAt = yield* Clock.currentTimeMillis;
      const input = ExecutionInput.fromSdkRequestBody(args.request);
      const checkpoint = yield* CheckpointRun.make({
        request: args.request,
        config: args.checkpointConfig,
        requestStartedAt,
      });
      const bus = yield* StepCommandBus.make;
      const identity = yield* StepIdentity.make;
      const baseContext = Context.make(CurrentExecutionInput, input).pipe(
        Context.add(CurrentCheckpoint, checkpoint),
        Context.add(InngestConfig, client.config),
        Context.add(StepCommandBus, bus),
        Context.add(StepIdentity, identity),
        Context.add(HandlerFiberScope, {
          isForkedFromHandlerRoot: Effect.map(Effect.fiberId, (fiberId) => fiberId !== rootFiberId),
        }),
      );
      const stepTools = yield* StepTools.make.pipe(Effect.provide(baseContext));
      const context = Context.add(baseContext, StepTools, stepTools);

      return yield* effect.pipe(Effect.provide(context));
    });
