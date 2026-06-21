/**
 * Wire protocol schemas and opcode factories for Inngest communication.
 * @internal
 */
import { Effect, Predicate, SchemaTransformation, Struct, Schema } from "effect";
import type { StepInfo } from "./domain/StepInfo.js";

const stripTopLevelTag = (value: unknown): unknown => {
  if (Predicate.isObject(value)) {
    return Struct.omit(value as Record<string, unknown>, ["_tag"]);
  }
  return value;
};

const WireUnknown = Schema.Unknown.pipe(
  Schema.decodeTo(
    Schema.Unknown,
    SchemaTransformation.transform({
      decode: (value) => value,
      encode: (value) => stripTopLevelTag(value),
    }),
  ),
);

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

// Native TS SDK emits sha1("complete") for terminal RunComplete opcodes.
const RUN_COMPLETE_ID = "0737c22d3bfae812339732d14d8c7dbd6dc4e09c";

type OpcodeValue = (typeof Opcode)[keyof typeof Opcode];

export class UserError extends Schema.Class<UserError>("UserError")({
  name: Schema.String,
  message: Schema.String,
  stack: Schema.optional(Schema.String),
  data: Schema.optional(Schema.Unknown),
  noRetry: Schema.optional(Schema.Boolean),
  cause: Schema.optional(Schema.Unknown),
}) {
  static fromUnknown(error: unknown): UserError {
    return UserError.make({
      name: Predicate.hasProperty(error, "name") ? String(error.name) : "Error",
      message: Predicate.hasProperty(error, "message") ? String(error.message) : String(error),
      stack: Predicate.hasProperty(error, "stack") ? String(error.stack) : undefined,
    });
  }
}

export const StepResult = Schema.NullOr(
  Schema.Record(Schema.String, Schema.Unknown).pipe(Schema.annotate({ identifier: "StepResultObject" })),
);

export class FunctionStack extends Schema.Class<FunctionStack>("FunctionStack")({
  stack: Schema.Array(Schema.String),
  current: Schema.Number,
}) {}

export class InngestEvent extends Schema.Class<InngestEvent>("InngestEvent")({
  id: Schema.optional(Schema.String),
  name: Schema.String,
  data: Schema.NullOr(Schema.Record(Schema.String, Schema.Unknown)).pipe(
    Schema.withDecodingDefaultType(Effect.succeed({})),
  ),

  ts: Schema.optional(Schema.Number),
  user: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
  v: Schema.optional(Schema.String),
}) {}

export class SDKRequestContext extends Schema.Class<SDKRequestContext>("SDKRequestContext")({
  fn_id: Schema.String,
  run_id: Schema.String,
  env: Schema.String.pipe(Schema.withDecodingDefault(Effect.succeed("dev"))),
  step_id: Schema.String.pipe(Schema.withDecodingDefault(Effect.succeed("step"))),
  attempt: Schema.Number.pipe(Schema.withDecodingDefault(Effect.succeed(0))),
  max_attempts: Schema.Number.pipe(Schema.withDecodingDefault(Effect.succeed(4))),
  stack: FunctionStack.pipe(
    Schema.withDecodingDefaultType(Effect.succeed(FunctionStack.make({ stack: [], current: 0 }))),
  ),
  qi_id: Schema.String.pipe(Schema.withDecodingDefault(Effect.succeed(""))),
  request_id: Schema.optionalKey(Schema.String),
  generation_id: Schema.optionalKey(Schema.Number),
  disable_immediate_execution: Schema.Boolean.pipe(Schema.withDecodingDefault(Effect.succeed(false))),
  use_api: Schema.Boolean.pipe(Schema.withDecodingDefault(Effect.succeed(false))),
}) {}

export class SDKRequestBody extends Schema.Class<SDKRequestBody>("SDKRequestBody")({
  event: InngestEvent,
  events: Schema.Array(InngestEvent),
  steps: Schema.Record(Schema.String, StepResult).pipe(Schema.withDecodingDefault(Effect.succeed({}))),
  ctx: SDKRequestContext,
  version: Schema.Number.pipe(Schema.withDecodingDefault(Effect.succeed(1))),
  use_api: Schema.Boolean.pipe(Schema.withDecodingDefault(Effect.succeed(false))),
}) {}

export const Headers = {
  SDK: "X-Inngest-SDK",
  Signature: "X-Inngest-Signature",
  RequestVersion: "x-inngest-req-version",
  NoRetry: "X-Inngest-No-Retry",
  RetryAfter: "Retry-After",
  SDKHandled: "x-inngest-sdk-handled",
  SyncKind: "x-inngest-sync-kind",
  ServerKind: "X-Inngest-Server-Kind",
  ExpectedServerKind: "X-Inngest-Expected-Server-Kind",
  RunID: "X-Run-ID",
  Framework: "X-Inngest-Framework",
  Platform: "X-Inngest-Platform",
  Env: "X-Inngest-Env",
} as const;

export class GeneratorOpcode extends Schema.Class<GeneratorOpcode>("GeneratorOpcode")({
  op: Schema.Literals([
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
  ]),
  id: Schema.String,
  name: Schema.optional(Schema.String),
  mode: Schema.optional(Schema.Literals(["sync", "async"])),
  opts: Schema.optional(WireUnknown),
  data: Schema.optional(WireUnknown),
  error: Schema.optional(UserError),
  displayName: Schema.optional(Schema.String),
  userland: Schema.optional(Schema.Struct({ id: Schema.String })),
  timing: Schema.optional(Schema.Struct({ a: Schema.Number, b: Schema.Number })),
}) {
  static makeStep(args: {
    readonly info: StepInfo;
    readonly op: OpcodeValue;
    readonly extra?: object;
  }): GeneratorOpcode {
    return GeneratorOpcode.make({
      op: args.op,
      id: args.info.hash,
      name: args.info.id,
      displayName: args.info.name,
      ...args.extra,
    });
  }

  static stepPlanned(info: StepInfo): GeneratorOpcode {
    return GeneratorOpcode.makeStep({
      info,
      op: Opcode.StepPlanned,
      extra: { opts: {}, userland: { id: info.id }, data: null },
    });
  }

  static sendEventStepPlanned(info: StepInfo): GeneratorOpcode {
    return GeneratorOpcode.makeStep({
      info,
      op: Opcode.StepPlanned,
      extra: {
        name: "sendEvent",
        opts: { type: "step.sendEvent" },
        userland: { id: info.id },
        data: null,
      },
    });
  }

  static stepRun(args: { readonly info: StepInfo; readonly data: unknown }): GeneratorOpcode {
    return GeneratorOpcode.makeStep({
      info: args.info,
      op: Opcode.StepRun,
      extra: {
        mode: "sync",
        opts: {},
        userland: { id: args.info.id },
        rawArgs: [args.info.rawStepArg ?? args.info.id, null],
        hashedId: args.info.hash,
        fulfilled: true,
        hasStepState: true,
        handled: true,
        promise: {},
        middleware: {
          stepInfo: {
            hashedId: args.info.hash,
            memoized: false,
            options: { id: args.info.id, name: args.info.name },
            stepType: "run",
          },
        },
        memoizationDeferred: { promise: {} },
        transformedResultPromise: {},
        ...(Predicate.isNotUndefined(args.data) ? { data: args.data } : {}),
        timing: { a: Date.now() * 1_000_000, b: 0 },
      },
    });
  }

  static sendEventStepRun(args: {
    readonly info: StepInfo;
    readonly data: unknown;
    readonly rawPayload: unknown;
  }): GeneratorOpcode {
    return GeneratorOpcode.makeStep({
      info: args.info,
      op: Opcode.StepRun,
      extra: {
        name: "sendEvent",
        mode: "sync",
        userland: { id: args.info.id },
        opts: { type: "step.sendEvent" },
        rawArgs: [args.info.id, args.rawPayload],
        hashedId: args.info.hash,
        promise: {},
        fulfilled: true,
        hasStepState: true,
        handled: true,
        middleware: {
          stepInfo: {
            hashedId: args.info.hash,
            memoized: false,
            options: { id: args.info.id, name: args.info.name },
            stepType: "sendEvent",
          },
        },
        memoizationDeferred: { promise: {} },
        transformedResultPromise: {},
        data: args.data,
        timing: { a: Date.now() * 1_000_000, b: 0 },
      },
    });
  }

  static stepRunResponse(args: { readonly info: StepInfo; readonly data: unknown }): GeneratorOpcode {
    return GeneratorOpcode.makeStep({
      info: args.info,
      op: Opcode.StepRun,
      extra: {
        opts: {},
        userland: { id: args.info.id },
        ...(Predicate.isNotUndefined(args.data) ? { data: args.data } : {}),
        timing: { a: Date.now() * 1_000_000, b: 0 },
      },
    });
  }

  static sendEventStepRunResponse(args: { readonly info: StepInfo; readonly data: unknown }): GeneratorOpcode {
    return GeneratorOpcode.makeStep({
      info: args.info,
      op: Opcode.StepRun,
      extra: {
        name: "sendEvent",
        opts: { type: "step.sendEvent" },
        userland: { id: args.info.id },
        data: args.data,
        timing: { a: Date.now() * 1_000_000, b: 0 },
      },
    });
  }

  static stepError(args: {
    readonly info: StepInfo;
    readonly error: UserError;
    readonly noRetry?: boolean;
  }): GeneratorOpcode {
    const error = Predicate.isNotUndefined(args.noRetry)
      ? UserError.make({
          name: args.error.name,
          message: args.error.message,
          stack: args.error.stack,
          noRetry: args.noRetry,
        })
      : args.error;
    return GeneratorOpcode.makeStep({ info: args.info, op: Opcode.StepError, extra: { error } });
  }

  static stepFailed(args: { readonly info: StepInfo; readonly error: UserError }): GeneratorOpcode {
    return GeneratorOpcode.makeStep({
      info: args.info,
      op: Opcode.StepFailed,
      extra: {
        opts: {},
        userland: { id: args.info.id },
        error: args.error,
        data: {
          __serialized: true,
          name: args.error.name,
          message: args.error.message,
          stack: "",
        },
      },
    });
  }

  static sleep(args: { readonly info: StepInfo; readonly duration: string }): GeneratorOpcode {
    return GeneratorOpcode.make({
      op: Opcode.Sleep,
      id: args.info.hash,
      name: args.duration,
      displayName: args.info.name,
      opts: {},
      userland: { id: args.info.id },
      data: null,
    });
  }

  static waitForEvent(args: {
    readonly info: StepInfo;
    readonly event: string;
    readonly timeout: string;
    readonly if?: string;
  }): GeneratorOpcode {
    return GeneratorOpcode.make({
      op: Opcode.WaitForEvent,
      id: args.info.hash,
      name: args.event,
      displayName: args.info.name,
      opts: {
        timeout: args.timeout,
        ...(Predicate.isNotUndefined(args.if) ? { if: args.if } : {}),
      },
      userland: { id: args.info.id },
      data: null,
    });
  }

  static invokeFunction(args: {
    readonly info: StepInfo;
    readonly functionId: string;
    readonly payload: unknown;
    readonly timeout?: string;
  }): GeneratorOpcode {
    return GeneratorOpcode.make({
      op: Opcode.InvokeFunction,
      id: args.info.hash,
      displayName: args.info.name,
      opts: {
        payload: args.payload,
        function_id: args.functionId,
        ...(Predicate.isNotUndefined(args.timeout) ? { timeout: args.timeout } : {}),
      },
      userland: { id: args.info.id },
      data: null,
    });
  }

  static runComplete(data: unknown): GeneratorOpcode {
    return GeneratorOpcode.make({ op: Opcode.RunComplete, id: RUN_COMPLETE_ID, data });
  }

  static discoveryRequest(): GeneratorOpcode {
    return GeneratorOpcode.make({ op: Opcode.DiscoveryRequest, id: "step", name: "step" });
  }
}

const IntrospectionBase = Schema.Struct({
  function_count: Schema.Number,
  has_event_key: Schema.Boolean,
  has_signing_key: Schema.Boolean,
  has_signing_key_fallback: Schema.optional(Schema.Boolean),
  mode: Schema.Literals(["cloud", "dev"]),
  schema_version: Schema.Literal("2024-05-24"),
  extra: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
});

export const IntrospectionUnauthenticated = IntrospectionBase.pipe(
  Schema.fieldsAssign({
    authentication_succeeded: Schema.optional(Schema.Union([Schema.Literal(false), Schema.Null])),
    capabilities: Schema.optional(Schema.Record(Schema.String, Schema.String)),
    functions: Schema.optionalKey(Schema.Array(Schema.Unknown)),
  }),
);

export const IntrospectionAuthenticated = IntrospectionBase.pipe(
  Schema.fieldsAssign({
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

export const IntrospectionResponse = Schema.Union([IntrospectionAuthenticated, IntrospectionUnauthenticated]);

/**
 * SDK → executor response shape for PUT sync requests per spec §4.3.1.
 */
export const RegisterResponse = Schema.Struct({
  message: Schema.String,
  modified: Schema.Boolean,
});

/**
 * Executor → SDK response shape from `POST /fn/register` per spec §4.3.4.
 * On success the body has `{ ok: true, modified?: boolean }`; on failure
 * the body may carry an `error` string.
 */
export const RegisterServerResponse = Schema.Union([
  Schema.Struct({
    ok: Schema.Literal(true),
    modified: Schema.optional(Schema.Boolean),
  }),
  Schema.Struct({
    error: Schema.optional(Schema.String),
  }),
]);
