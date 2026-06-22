import * as Headers from "effect/unstable/http/Headers";
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

  toHeaders(): Headers.Headers {
    if (Option.isSome(this.retryAfterMs)) {
      return Headers.fromInput({
        [Protocol.Headers.NoRetry]: "false",
        [Protocol.Headers.RetryAfter]: String(Math.ceil(this.retryAfterMs.value / 1000)),
      });
    }

    if (this.noRetry) {
      return Headers.fromInput({ [Protocol.Headers.NoRetry]: "true" });
    }

    if (this.isFailure) {
      return Headers.fromInput({ [Protocol.Headers.NoRetry]: "false" });
    }

    return Headers.empty;
  }
}

export const base = (config: ClientConfig): Headers.Headers =>
  Headers.fromInput({
    "Content-Type": "application/json",
    "User-Agent": `effect-inngest:v${SDK_VERSION}`,
    [Protocol.Headers.SDK]: `effect-inngest:v${SDK_VERSION}`,
    [Protocol.Headers.SDKHandled]: "true",
    [Protocol.Headers.RequestVersion]: "2",
    ...(config.framework ? { [Protocol.Headers.Framework]: config.framework } : {}),
  });

export const merge = (headers: Headers.Headers, retry: RetryDisposition): Headers.Headers =>
  Headers.merge(headers, retry.toHeaders());
