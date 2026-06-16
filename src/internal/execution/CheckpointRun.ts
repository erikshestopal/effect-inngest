import { Effect, Option } from "effect";
import { InngestClient } from "../../Client.js";
import * as Checkpoint from "../checkpoint.js";
import type { CheckpointConfig, CheckpointState } from "../checkpoint.js";
import * as Protocol from "../protocol.js";

export const make = (args: {
  readonly request: Protocol.SDKRequestBody;
  readonly config: Option.Option<CheckpointConfig>;
  readonly requestStartedAt: number;
}): Effect.Effect<Option.Option<CheckpointState>, never, InngestClient> =>
  Option.match(args.config, {
    onNone: () => Effect.succeed(Option.none()),
    onSome: (config) =>
      InngestClient.use((client) =>
        Checkpoint.make({
          config,
          runId: args.request.ctx.run_id,
          fnId: args.request.ctx.fn_id,
          qiId: args.request.ctx.qi_id,
          checkpointAsync: (steps) =>
            client.checkpointAsync({
              runId: args.request.ctx.run_id,
              fnId: args.request.ctx.fn_id,
              qiId: args.request.ctx.qi_id,
              requestId: args.request.ctx.request_id,
              generationId: args.request.ctx.generation_id,
              requestStartedAt: args.requestStartedAt,
              steps,
            }),
        }).pipe(Effect.map(Option.some)),
      ),
  });
