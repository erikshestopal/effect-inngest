import { Cause, Duration, Effect, Exit, Match, Option } from "effect";
import { InngestConfig } from "../../Client.js";
import { CurrentCheckpoint } from "../runtime/CheckpointContext.js";
import { StepCommandBus } from "../runtime/StepCommandBus.js";
import { isNonRetriableError, isRetryAfterError, isStepError } from "../errors.js";
import * as Protocol from "../protocol.js";
import * as ExecutionHeaders from "./ExecutionHeaders.js";
import { ExecutionResult, encodeOpcodes } from "./ExecutionResult.js";
import * as HandlerRun from "./HandlerRun.js";

const commandDisposition = (commands: StepCommandBus.InterruptedCommands) => {
  if (!commands.hasRetriableStepError && !commands.hasNonRetriableError && Option.isNone(commands.retryAfterMs)) {
    return ExecutionHeaders.RetryDisposition.none;
  }

  return ExecutionHeaders.RetryDisposition.failure({
    noRetry: commands.hasNonRetriableError,
    retryAfterMs: commands.retryAfterMs,
  });
};

const firstErrorOrDefect = (cause: Cause.Cause<unknown>) =>
  Option.orElse(Cause.findErrorOption(cause), () => {
    const dieReason = cause.reasons.find(Cause.isDieReason);
    return dieReason ? Option.some(dieReason.defect) : Option.none();
  }).pipe(Option.getOrElse(() => Protocol.UserError.make({ name: "Error", message: "Unknown error" })));

const errorDisposition = (error: unknown) => {
  if (isRetryAfterError(error)) {
    return ExecutionHeaders.RetryDisposition.failure({
      noRetry: false,
      retryAfterMs: Option.some(Duration.toMillis(error.retryAfter)),
    });
  }
  return ExecutionHeaders.RetryDisposition.failure({
    noRetry: isNonRetriableError(error) || (isStepError(error) && error.noRetry === true),
  });
};

const fromSuccess = (args: {
  readonly completion: HandlerRun.HandlerCompletion;
  readonly headers: Record<string, string>;
}) =>
  Effect.gen(function* () {
    const bus = yield* StepCommandBus;
    const checkpoint = yield* CurrentCheckpoint;
    const completed = yield* bus.completed;

    if (Option.isSome(checkpoint)) {
      const terminal = Match.value(args.completion).pipe(
        Match.tag("CheckpointDeadlineElapsed", () => Protocol.GeneratorOpcode.discoveryRequest()),
        Match.tag("HandlerSucceeded", (completion) => Protocol.GeneratorOpcode.runComplete(completion.value)),
        Match.exhaustive,
      );

      return ExecutionResult.make({
        status: 206,
        body: encodeOpcodes([...completed, terminal]),
        headers: args.headers,
      });
    }

    return Match.value(args.completion).pipe(
      Match.tag("HandlerSucceeded", (completion) =>
        ExecutionResult.make({ status: 200, body: completion.value, headers: args.headers }),
      ),
      Match.tag("CheckpointDeadlineElapsed", () =>
        ExecutionResult.make({
          status: 500,
          body: Protocol.UserError.make({
            name: "Error",
            message: "Checkpoint deadline elapsed outside checkpoint mode",
          }),
          headers: ExecutionHeaders.withRetryDisposition({
            headers: args.headers,
            disposition: ExecutionHeaders.RetryDisposition.failure({ noRetry: false }),
          }),
        }),
      ),
      Match.exhaustive,
    );
  });

const fromFailure = (args: { readonly cause: Cause.Cause<unknown>; readonly headers: Record<string, string> }) =>
  Effect.gen(function* () {
    const bus = yield* StepCommandBus;
    const commands = yield* bus.interrupted;

    if (commands.suspendedCount > 0 && Cause.hasInterruptsOnly(args.cause)) {
      return ExecutionResult.make({
        status: 206,
        body: encodeOpcodes(commands.opcodes),
        headers: ExecutionHeaders.withRetryDisposition({
          headers: args.headers,
          disposition: commandDisposition(commands),
        }),
      });
    }

    if (Cause.hasInterruptsOnly(args.cause)) {
      return yield* Effect.interrupt;
    }

    const error = firstErrorOrDefect(args.cause);
    const disposition = errorDisposition(error);

    if (commands.completed.length > 0) {
      return ExecutionResult.make({
        status: 206,
        body: encodeOpcodes(commands.completed),
        headers: ExecutionHeaders.withRetryDisposition({ headers: args.headers, disposition }),
      });
    }

    return ExecutionResult.make({
      status: disposition.noRetry ? 400 : 500,
      body: Protocol.UserError.fromUnknown(error),
      headers: ExecutionHeaders.withRetryDisposition({ headers: args.headers, disposition }),
    });
  });

export const fromExit = (exit: Exit.Exit<HandlerRun.HandlerCompletion, unknown>) =>
  Effect.gen(function* () {
    const config = yield* InngestConfig;
    const bus = yield* StepCommandBus;
    const headers = ExecutionHeaders.base(config);
    const planned = yield* bus.planned;

    if (planned.length > 0) {
      return ExecutionResult.make({ status: 206, body: encodeOpcodes(planned), headers });
    }

    return yield* Exit.match(exit, {
      onSuccess: (completion) => fromSuccess({ completion, headers }),
      onFailure: (cause) => fromFailure({ cause, headers }),
    });
  });
