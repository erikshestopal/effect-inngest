import { Duration, Option, Predicate } from "effect";
import type { ClientConfig } from "../../Client.js";
import type { ExecutionSuspension } from "../domain/ExecutionSuspension.js";
import { isNonRetriableError, isRetryAfterError, isStepError } from "../errors.js";
import * as Protocol from "../protocol.js";

const SDK_VERSION = "2.0.0";

export class RetryDisposition {
  readonly noRetry: boolean;
  readonly isFailure: boolean;
  readonly retryAfterMs: Option.Option<number>;

  private constructor(args: {
    readonly noRetry: boolean;
    readonly isFailure: boolean;
    readonly retryAfterMs: Option.Option<number>;
  }) {
    this.noRetry = args.noRetry;
    this.isFailure = args.isFailure;
    this.retryAfterMs = args.retryAfterMs;
  }

  static readonly none = new RetryDisposition({
    noRetry: false,
    isFailure: false,
    retryAfterMs: Option.none(),
  });

  static failure(args: { readonly noRetry: boolean; readonly retryAfterMs?: Option.Option<number> }) {
    return new RetryDisposition({
      noRetry: args.noRetry,
      isFailure: true,
      retryAfterMs: args.retryAfterMs ?? Option.none(),
    });
  }

  static fromSuspension(commands: ExecutionSuspension) {
    const hasRetriableStepError = RetryDisposition.hasRetriableStepError(commands);
    const hasNonRetriableError = RetryDisposition.hasNonRetriableError(commands);

    if (!hasRetriableStepError && !hasNonRetriableError && Option.isNone(commands.retryAfterMs)) {
      return RetryDisposition.none;
    }

    return RetryDisposition.failure({
      noRetry: hasNonRetriableError,
      retryAfterMs: commands.retryAfterMs,
    });
  }

  static fromError(error: unknown) {
    if (isRetryAfterError(error)) {
      return RetryDisposition.failure({
        noRetry: false,
        retryAfterMs: Option.some(Duration.toMillis(error.retryAfter)),
      });
    }

    return RetryDisposition.failure({
      noRetry: isNonRetriableError(error) || (isStepError(error) && error.noRetry === true),
    });
  }

  private static hasRetriableStepError(commands: ExecutionSuspension): boolean {
    return commands.opcodes.some((op) => op.op === Protocol.Opcode.StepError);
  }

  private static hasNonRetriableError(commands: ExecutionSuspension): boolean {
    return commands.opcodes.some(
      (op) =>
        op.op === Protocol.Opcode.StepFailed ||
        (op.op === Protocol.Opcode.StepError &&
          Predicate.isObject(op.error) &&
          Predicate.hasProperty(op.error, "noRetry") &&
          op.error.noRetry === true),
    );
  }
}

export const base = (config: ClientConfig): Record<string, string> => ({
  "Content-Type": "application/json",
  "User-Agent": `effect-inngest:v${SDK_VERSION}`,
  [Protocol.Headers.SDK]: `effect-inngest:v${SDK_VERSION}`,
  [Protocol.Headers.SDKHandled]: "true",
  [Protocol.Headers.RequestVersion]: "2",
  ...(config.framework ? { [Protocol.Headers.Framework]: config.framework } : {}),
});

export const withRetryDisposition = (args: {
  readonly headers: Record<string, string>;
  readonly disposition: RetryDisposition;
}): Record<string, string> => {
  const { headers, disposition } = args;
  if (Option.isSome(disposition.retryAfterMs)) {
    return {
      ...headers,
      [Protocol.Headers.NoRetry]: "false",
      [Protocol.Headers.RetryAfter]: String(Math.ceil(disposition.retryAfterMs.value / 1000)),
    };
  }

  if (disposition.noRetry) {
    return { ...headers, [Protocol.Headers.NoRetry]: "true" };
  }

  if (disposition.isFailure) {
    return { ...headers, [Protocol.Headers.NoRetry]: "false" };
  }

  return headers;
};
