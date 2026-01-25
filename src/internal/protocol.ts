/**
 * Wire protocol schemas and opcode factories for Inngest communication.
 * @internal
 */
import { Predicate, Struct } from "effect";
import * as Schema from "effect/Schema";

const stripTags = (value: unknown): unknown => {
  if (Predicate.isRecord(value)) {
    const stripped = Struct.omit(value as Record<string, unknown>, "_tag");
    return Object.fromEntries(Object.entries(stripped).map(([k, v]) => [k, stripTags(v)]));
  }
  if (Array.isArray(value)) {
    return value.map(stripTags);
  }
  return value;
};

const WireUnknown = Schema.transform(Schema.Unknown, Schema.Unknown, {
  strict: true,
  decode: (value) => value,
  encode: (value) => stripTags(value),
});

export const Opcode = {
  None: "None",
  Step: "Step",
  StepRun: "StepRun",
  StepError: "StepError",
  StepPlanned: "StepPlanned",
  Sleep: "Sleep",
  WaitForEvent: "WaitForEvent",
  InvokeFunction: "InvokeFunction",
  AIGateway: "AIGateway",
  Gateway: "Gateway",
  WaitForSignal: "WaitForSignal",
  RunComplete: "RunComplete",
  StepFailed: "StepFailed",
  SyncRunComplete: "SyncRunComplete",
  DiscoveryRequest: "DiscoveryRequest",
} as const;

type OpcodeValue = (typeof Opcode)[keyof typeof Opcode];

export class UserError extends Schema.Class<UserError>("UserError")({
  name: Schema.String,
  message: Schema.String,
  stack: Schema.optional(Schema.String),
  data: Schema.optional(Schema.Unknown),
  noRetry: Schema.optional(Schema.Boolean),
  cause: Schema.optional(Schema.Unknown),
}) {}

export const StepResult = Schema.NullOr(
  Schema.Record({ key: Schema.String, value: Schema.Unknown }).pipe(
    Schema.annotations({ identifier: "StepResultObject" }),
  ),
);

export class FunctionStack extends Schema.Class<FunctionStack>("FunctionStack")({
  stack: Schema.Array(Schema.String),
  current: Schema.Number,
}) {}

export class InngestEvent extends Schema.Class<InngestEvent>("InngestEvent")({
  id: Schema.optional(Schema.String),
  name: Schema.String,
  data: Schema.optionalWith(Schema.Record({ key: Schema.String, value: Schema.Unknown }), {
    default: () => ({}),
    nullable: true,
  }),

  ts: Schema.optional(Schema.Number),
  user: Schema.optional(Schema.Record({ key: Schema.String, value: Schema.Unknown })),
  v: Schema.optional(Schema.String),
}) {}

export class SDKRequestContext extends Schema.Class<SDKRequestContext>("SDKRequestContext")({
  fn_id: Schema.String,
  run_id: Schema.String,
  env: Schema.optionalWith(Schema.String, { default: () => "dev" }),
  step_id: Schema.optionalWith(Schema.String, { default: () => "step" }),
  attempt: Schema.optionalWith(Schema.Number, { default: () => 0 }),
  max_attempts: Schema.optionalWith(Schema.Number, { default: () => 4 }),
  stack: Schema.optionalWith(FunctionStack, { default: () => FunctionStack.make({ stack: [], current: 0 }) }),
  qi_id: Schema.optionalWith(Schema.String, { default: () => "" }),
  disable_immediate_execution: Schema.optionalWith(Schema.Boolean, { default: () => false }),
  use_api: Schema.optionalWith(Schema.Boolean, { default: () => false }),
}) {}

export class SDKRequestBody extends Schema.Class<SDKRequestBody>("SDKRequestBody")({
  event: InngestEvent,
  events: Schema.Array(InngestEvent),
  steps: Schema.optionalWith(Schema.Record({ key: Schema.String, value: StepResult }), { default: () => ({}) }),
  ctx: SDKRequestContext,
  version: Schema.optionalWith(Schema.Number, { default: () => 1 }),
  use_api: Schema.optionalWith(Schema.Boolean, { default: () => false }),
}) {}

export const Headers = {
  SDK: "X-Inngest-SDK",
  Signature: "X-Inngest-Signature",
  RequestVersion: "x-inngest-req-version",
  NoRetry: "X-Inngest-No-Retry",
  RetryAfter: "Retry-After",
  ServerKind: "X-Inngest-Server-Kind",
  ExpectedServerKind: "X-Inngest-Expected-Server-Kind",
  RunID: "X-Run-ID",
  Framework: "X-Inngest-Framework",
  Platform: "X-Inngest-Platform",
  Env: "X-Inngest-Env",
} as const;

export class GeneratorOpcode extends Schema.Class<GeneratorOpcode>("GeneratorOpcode")({
  op: Schema.Literal(
    Opcode.None,
    Opcode.Step,
    Opcode.StepRun,
    Opcode.StepError,
    Opcode.StepPlanned,
    Opcode.Sleep,
    Opcode.WaitForEvent,
    Opcode.InvokeFunction,
    Opcode.AIGateway,
    Opcode.Gateway,
    Opcode.WaitForSignal,
    Opcode.RunComplete,
    Opcode.StepFailed,
    Opcode.SyncRunComplete,
    Opcode.DiscoveryRequest,
  ),
  id: Schema.String,
  name: Schema.String,
  mode: Schema.optional(Schema.Literal("sync", "async")),
  opts: Schema.optional(WireUnknown),
  data: Schema.optional(WireUnknown),
  error: Schema.optional(UserError),
  displayName: Schema.optional(Schema.String),
  userland: Schema.optional(Schema.Struct({ id: Schema.String })),
}) {}

interface StepInfo {
  readonly id: string;
  readonly name: string;
  readonly hash: string;
}

const mkOpcode = (info: StepInfo, op: OpcodeValue, extra?: object): GeneratorOpcode =>
  GeneratorOpcode.make({ op, id: info.hash, name: info.id, displayName: info.name, ...extra });

export const stepPlanned = (info: StepInfo): GeneratorOpcode => mkOpcode(info, Opcode.StepPlanned);

export const stepRun = (info: StepInfo, data: unknown): GeneratorOpcode => mkOpcode(info, Opcode.StepRun, { data });

export const stepError = (info: StepInfo, error: UserError, noRetry?: boolean): GeneratorOpcode => {
  // noRetry must be in the error object for Inngest executor to recognize it
  const errorWithNoRetry =
    noRetry !== undefined
      ? UserError.make({ name: error.name, message: error.message, stack: error.stack, noRetry })
      : error;
  return mkOpcode(info, Opcode.StepError, { error: errorWithNoRetry });
};

export const sleep = (info: StepInfo, duration: string): GeneratorOpcode =>
  // Official SDK puts duration/timestamp in `name` field, not opts.duration
  // mode: "async" is required per the Op type definition
  GeneratorOpcode.make({ op: Opcode.Sleep, id: info.hash, name: duration, displayName: info.name, mode: "async" });

export const waitForEvent = (info: StepInfo, opts: { event: string; timeout: string; if?: string }): GeneratorOpcode =>
  mkOpcode(info, Opcode.WaitForEvent, { mode: "async", opts });

export const invokeFunction = (
  info: StepInfo,
  opts: { function_id: string; payload: unknown; timeout: string },
): GeneratorOpcode => mkOpcode(info, Opcode.InvokeFunction, { mode: "async", opts, userland: { id: info.id } });

const IntrospectionBase = Schema.Struct({
  function_count: Schema.Number,
  has_event_key: Schema.Boolean,
  has_signing_key: Schema.Boolean,
  has_signing_key_fallback: Schema.Boolean,
  mode: Schema.Literal("cloud", "dev"),
  schema_version: Schema.Literal("2024-05-24"),
  extra: Schema.optional(Schema.Record({ key: Schema.String, value: Schema.Unknown })),
});

export const IntrospectionUnauthenticated = Schema.extend(
  IntrospectionBase,
  Schema.Struct({
    authentication_succeeded: Schema.Union(Schema.Literal(false), Schema.Null),
    functions: Schema.optionalWith(Schema.Array(Schema.Unknown), { exact: true }),
  }),
);

export const IntrospectionAuthenticated = Schema.extend(
  IntrospectionBase,
  Schema.Struct({
    authentication_succeeded: Schema.Literal(true),
    api_origin: Schema.String,
    app_id: Schema.String,
    env: Schema.NullOr(Schema.String),
    event_api_origin: Schema.String,
    event_key_hash: Schema.NullOr(Schema.String),
    framework: Schema.String,
    sdk_language: Schema.String,
    sdk_version: Schema.String,
    serve_origin: Schema.NullOr(Schema.String),
    serve_path: Schema.NullOr(Schema.String),
    signing_key_fallback_hash: Schema.NullOr(Schema.String),
    signing_key_hash: Schema.NullOr(Schema.String),
  }),
);

export const IntrospectionResponse = Schema.Union(IntrospectionAuthenticated, IntrospectionUnauthenticated);

export const RegisterResponse = Schema.Struct({
  message: Schema.optional(Schema.String),
});
