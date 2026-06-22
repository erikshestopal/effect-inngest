import { Duration, Option, Schema } from "effect";
import type { ClientConfig } from "../../Client.js";
import type { ExecutionSuspension } from "../domain/ExecutionSuspension.js";
import { isNonRetriableError, isRetryAfterError, isStepError } from "../errors.js";
import * as Protocol from "../protocol.js";

const SDK_VERSION = "2.0.0";

export class RetryDisposition extends Schema.Class<RetryDisposition>(
  "effect-inngest/internal/execution/RetryDisposition",
)({
  noRetry: Schema.Boolean,
  isFailure: Schema.Boolean,
  retryAfterMs: Schema.Option(Schema.Number),
}) {
  static readonly none = RetryDisposition.make({
    noRetry: false,
    isFailure: false,
    retryAfterMs: Option.none(),
  });

  static failure(args: { readonly noRetry: boolean; readonly retryAfterMs?: Option.Option<number> }) {
    return RetryDisposition.make({
      noRetry: args.noRetry,
      isFailure: true,
      retryAfterMs: args.retryAfterMs ?? Option.none(),
    });
  }

  static fromSuspension(commands: ExecutionSuspension) {
    if (!commands.hasFailure && Option.isNone(commands.retryAfterMs)) {
      return RetryDisposition.none;
    }

    return RetryDisposition.failure({
      noRetry: commands.noRetry,
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
