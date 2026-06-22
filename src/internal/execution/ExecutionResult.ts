import * as Headers from "effect/unstable/http/Headers";
import { Schema } from "effect";
import * as Protocol from "../protocol.js";
import * as ExecutionHeaders from "./ExecutionHeaders.js";

type GeneratorOpcode = typeof Protocol.GeneratorOpcode.Type;

export class ExecutionResult extends Schema.Class<ExecutionResult>("ExecutionResult")({
  status: Schema.Literals([200, 206, 400, 500]),
  body: Schema.Unknown,
  headers: Headers.HeadersSchema,
}) {
  static success(args: { readonly body: unknown; readonly headers: Headers.Headers }) {
    return ExecutionResult.make({ status: 200, body: args.body, headers: args.headers });
  }

  static opcodes(args: { readonly opcodes: ReadonlyArray<GeneratorOpcode>; readonly headers: Headers.Headers }) {
    return ExecutionResult.make({ status: 206, body: encodeOpcodes(args.opcodes), headers: args.headers });
  }

  static opcodesWithRetry(args: {
    readonly opcodes: ReadonlyArray<GeneratorOpcode>;
    readonly headers: Headers.Headers;
    readonly disposition: ExecutionHeaders.RetryDisposition;
  }) {
    return ExecutionResult.opcodes({
      opcodes: args.opcodes,
      headers: ExecutionHeaders.merge(args.headers, args.disposition),
    });
  }

  static userError(args: {
    readonly error: unknown;
    readonly headers: Headers.Headers;
    readonly disposition: ExecutionHeaders.RetryDisposition;
  }) {
    return ExecutionResult.make({
      status: args.disposition.noRetry ? 400 : 500,
      body: Protocol.UserError.fromUnknown(args.error),
      headers: ExecutionHeaders.merge(args.headers, args.disposition),
    });
  }

  static checkpointDeadlineOutsideCheckpoint(args: { readonly headers: Headers.Headers }) {
    return ExecutionResult.make({
      status: 500,
      body: Protocol.UserError.make({
        name: "Error",
        message: "Checkpoint deadline elapsed outside checkpoint mode",
      }),
      headers: ExecutionHeaders.merge(args.headers, ExecutionHeaders.RetryDisposition.failure({ noRetry: false })),
    });
  }
}

export const encodeOpcodes = (opcodes: ReadonlyArray<GeneratorOpcode>) =>
  Schema.encodeSync(Schema.Array(Protocol.GeneratorOpcode))(opcodes);
