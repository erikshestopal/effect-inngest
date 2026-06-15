/**
 * Shared response schemas for validating Inngest protocol responses in tests.
 */
import * as Schema from "effect/Schema";

/** Standard step opcode response (StepPlanned, StepRun, etc.) */
export const StepOpcodeResponse = Schema.Array(
  Schema.Struct({
    op: Schema.String,
    id: Schema.String,
    name: Schema.String,
    displayName: Schema.String,
  }),
);

/** Step response with error payload */
export const StepErrorResponse = Schema.Array(
  Schema.Struct({
    op: Schema.String,
    id: Schema.String,
    name: Schema.String,
    displayName: Schema.String,
    error: Schema.Struct({
      name: Schema.String,
      message: Schema.String,
    }),
  }),
);

/** Sleep opcode response — native SDK v4 uses `name` for the duration/timestamp. */
export const SleepOpcodeResponse = Schema.Array(
  Schema.Struct({
    op: Schema.String,
    id: Schema.String,
    name: Schema.String,
    displayName: Schema.String,
    opts: Schema.Record(Schema.String, Schema.Never),
    userland: Schema.Struct({ id: Schema.String }),
    data: Schema.Null,
  }),
);

/** WaitForEvent opcode response */
export const WaitForEventOpcodeResponse = Schema.Array(
  Schema.Struct({
    op: Schema.String,
    id: Schema.String,
    name: Schema.String,
    displayName: Schema.String,
    opts: Schema.Struct({
      timeout: Schema.String,
      if: Schema.optional(Schema.String),
    }),
    userland: Schema.Struct({ id: Schema.String }),
    data: Schema.Null,
  }),
);

/** InvokeFunction opcode response */
export const InvokeFunctionResponse = Schema.Array(
  Schema.Struct({
    op: Schema.String,
    id: Schema.String,
    displayName: Schema.String,
    data: Schema.Null,
    userland: Schema.Struct({ id: Schema.String }),
    opts: Schema.Struct({
      function_id: Schema.String,
      payload: Schema.Struct({
        data: Schema.Unknown,
      }),
      timeout: Schema.optional(Schema.String),
    }),
  }),
);

/** Mixed opcodes response (for parallel steps) */
export const MixedOpcodeResponse = Schema.Array(
  Schema.Struct({
    op: Schema.String,
    id: Schema.String,
    name: Schema.String,
  }),
);

/** Simple step opcode schema (id only) */
export const StepOpcodeSchema = Schema.Struct({ id: Schema.String });
export const StepOpcodesSchema = Schema.Array(StepOpcodeSchema);

/** Error response schema */
export const ErrorResponseSchema = Schema.Struct({
  error: Schema.Struct({ message: Schema.String }),
});
