import type * as Headers from "effect/unstable/http/Headers";
import { Cause, Effect, Exit, Match, Option } from "effect";
import { InngestConfig } from "../../Client.js";
import { CurrentCheckpoint } from "../runtime/CheckpointContext.js";
import { StepCommandBus } from "../runtime/StepCommandBus.js";
import * as Protocol from "../protocol.js";
import { ExecutionFailure } from "./ExecutionFailure.js";
import * as ExecutionHeaders from "./ExecutionHeaders.js";
import { ExecutionResult } from "./ExecutionResult.js";
import * as HandlerRun from "./HandlerRun.js";

const fromSuccess = (args: { readonly completion: HandlerRun.HandlerCompletion; readonly headers: Headers.Headers }) =>
  Effect.gen(function* () {
    const bus = yield* StepCommandBus;
    const checkpoint = yield* CurrentCheckpoint;
    const completed = yield* bus.takeCompleted();

    if (Option.isSome(checkpoint)) {
      const terminal = Match.value(args.completion).pipe(
        Match.tag("CheckpointDeadlineElapsed", () => Protocol.GeneratorOpcode.discoveryRequest()),
        Match.tag("HandlerSucceeded", (completion) => Protocol.GeneratorOpcode.runComplete(completion.value)),
        Match.exhaustive,
      );

      return ExecutionResult.opcodes({ opcodes: [...completed, terminal], headers: args.headers });
    }

    return Match.value(args.completion).pipe(
      Match.tag("HandlerSucceeded", (completion) =>
        ExecutionResult.success({ body: completion.value, headers: args.headers }),
      ),
      Match.tag("CheckpointDeadlineElapsed", () => ExecutionResult.checkpointDeadlineOutsideCheckpoint(args)),
      Match.exhaustive,
    );
  });

const fromFailure = (args: { readonly cause: Cause.Cause<unknown>; readonly headers: Headers.Headers }) =>
  Effect.gen(function* () {
    const bus = yield* StepCommandBus;
    const commands = yield* bus.takeSuspension();

    if (commands.suspendedCount > 0 && Cause.hasInterruptsOnly(args.cause)) {
      return ExecutionResult.opcodesWithRetry({
        opcodes: commands.opcodes,
        headers: args.headers,
        disposition: ExecutionHeaders.RetryDisposition.fromSuspension(commands),
      });
    }

    if (Cause.hasInterruptsOnly(args.cause)) {
      return yield* Effect.interrupt;
    }

    const failure = ExecutionFailure.fromCause(args.cause);
    const disposition = ExecutionHeaders.RetryDisposition.fromError(failure.error);

    if (commands.completed.length > 0) {
      return ExecutionResult.opcodesWithRetry({ opcodes: commands.completed, headers: args.headers, disposition });
    }

    return ExecutionResult.userError({ error: failure.error, headers: args.headers, disposition });
  });

export const fromExit = (exit: Exit.Exit<HandlerRun.HandlerCompletion, unknown>) =>
  Effect.gen(function* () {
    const config = yield* InngestConfig;
    const bus = yield* StepCommandBus;
    const headers = ExecutionHeaders.base(config);
    const planned = yield* bus.takePlanned();

    if (planned.length > 0) {
      return ExecutionResult.opcodes({ opcodes: planned, headers });
    }

    return yield* Exit.match(exit, {
      onSuccess: (completion) => fromSuccess({ completion, headers }),
      onFailure: (cause) => fromFailure({ cause, headers }),
    });
  });
