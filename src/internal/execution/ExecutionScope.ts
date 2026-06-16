import { Clock, Context, Effect, Option } from "effect";
import { InngestClient, InngestConfig } from "../../Client.js";
import * as CheckpointRun from "./CheckpointRun.js";
import type { CheckpointConfig } from "../checkpoint.js";
import * as Protocol from "../protocol.js";
import { CurrentExecutionInput, ExecutionInput } from "../../next/internal/domain/ExecutionInput.js";
import { CurrentCheckpoint } from "../../next/internal/runtime/CheckpointContext.js";
import { EventApi } from "../../next/internal/runtime/EventApi.js";
import { StepCommandSink } from "../../next/internal/runtime/StepCommandSink.js";
import { StepIdentity } from "../../next/internal/runtime/StepIdentity.js";
import { StepTools } from "../../next/internal/runtime/StepTools.js";

export const provide =
  (args: { readonly request: Protocol.SDKRequestBody; readonly checkpointConfig: Option.Option<CheckpointConfig> }) =>
  <A, E, R>(effect: Effect.Effect<A, E, R>) =>
    Effect.gen(function* () {
      const client = yield* InngestClient;
      const requestStartedAt = yield* Clock.currentTimeMillis;
      const input = ExecutionInput.fromSdkRequestBody(args.request);
      const checkpoint = yield* CheckpointRun.make({
        request: args.request,
        config: args.checkpointConfig,
        requestStartedAt,
      });
      const sink = yield* StepCommandSink.make;
      const identity = yield* StepIdentity.make;
      const eventApi = yield* EventApi.make;
      const baseContext = Context.make(CurrentExecutionInput, input).pipe(
        Context.add(CurrentCheckpoint, checkpoint),
        Context.add(InngestConfig, client.config),
        Context.add(StepCommandSink, sink),
        Context.add(StepIdentity, identity),
        Context.add(EventApi, eventApi),
      );
      const stepTools = yield* StepTools.make.pipe(Effect.provide(baseContext));
      const context = Context.add(baseContext, StepTools, stepTools);

      return yield* effect.pipe(Effect.provide(context));
    });
