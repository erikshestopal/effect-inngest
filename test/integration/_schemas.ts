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

/** Sleep opcode response — spec §5.3.2 requires `opts.duration` */
export const SleepOpcodeResponse = Schema.Array(
  Schema.Struct({
    op: Schema.String,
    id: Schema.String,
    name: Schema.String,
    displayName: Schema.String,
    mode: Schema.Literal("async"),
    opts: Schema.Struct({ duration: Schema.String }),
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
      event: Schema.String,
      timeout: Schema.String,
      if: Schema.optional(Schema.String),
    }),
  }),
);

/** InvokeFunction opcode response */
export const InvokeFunctionResponse = Schema.Array(
  Schema.Struct({
    op: Schema.String,
    id: Schema.String,
    name: Schema.String,
    mode: Schema.String,
    displayName: Schema.String,
    opts: Schema.Struct({
      function_id: Schema.String,
      payload: Schema.Struct({
        data: Schema.Unknown,
      }),
      timeout: Schema.String,
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
