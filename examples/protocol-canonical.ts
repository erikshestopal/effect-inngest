export type RuntimeName = "native" | "effect";

export type Json = null | boolean | number | string | ReadonlyArray<Json> | { readonly [key: string]: Json };

export interface ObservedExchange {
  readonly sequence: number;
  readonly direction: "inbound" | "outbound";
  readonly proxy: string;
  readonly request: Record<string, unknown>;
  readonly response: Record<string, unknown>;
}

export interface EventExampleCase {
  readonly kind: "event";
  readonly eventKey?: string;
  readonly events: ReadonlyArray<Record<string, unknown>>;
  readonly afterEvents?: ReadonlyArray<{
    readonly delayMs: number;
    readonly eventKey?: string;
    readonly events: ReadonlyArray<Record<string, unknown>>;
  }>;
  readonly expect?: ReadonlyArray<{
    readonly functionId?: string;
    readonly functionTag?: string;
    readonly status?: string | ReadonlyArray<string>;
  }>;
}

export interface EffectExampleCase {
  readonly kind: "effect";
  readonly expect?: ReadonlyArray<never>;
  readonly timeoutMs?: number;
}

export type ExampleCase = EventExampleCase | EffectExampleCase;

export interface ExampleManifestEntry {
  readonly id: string;
  readonly path?: string;
  readonly cases: ReadonlyArray<ExampleCase>;
}

export interface CanonicalFixture {
  readonly schema: "inngest-protocol-canonical/v1";
  readonly exampleId: string;
  readonly runtime: RuntimeName;
  readonly registration: {
    readonly introspection?: Json;
    readonly sync?: Json;
    readonly register?: Json;
  };
  readonly events: ReadonlyArray<Json>;
  readonly executions: ReadonlyArray<Json>;
  readonly checkpoints: ReadonlyArray<Json>;
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const toJson = (value: unknown): Json => {
  if (value === null || typeof value === "boolean" || typeof value === "number" || typeof value === "string")
    return value;
  if (Array.isArray(value)) return value.map(toJson);
  if (!isObject(value)) return String(value);
  return sortObject(Object.fromEntries(Object.entries(value).map(([key, child]) => [key, toJson(child)])));
};

const sortObject = (value: Record<string, Json>): Record<string, Json> =>
  Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right)));

const stableSort = <A>(items: ReadonlyArray<A>, key: (item: A) => string): ReadonlyArray<A> =>
  [...items].sort((left, right) => key(left).localeCompare(key(right)));

const removeKeys = (value: unknown, keys: ReadonlySet<string>): unknown => {
  if (Array.isArray(value)) return value.map((item) => removeKeys(item, keys));
  if (!isObject(value)) return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => !keys.has(key))
      .map(([key, child]) => [key, removeKeys(child, keys)] as const),
  );
};

const normalizeUrl = (value: unknown): unknown => {
  if (typeof value !== "string") return value;
  return value
    .replace(/https?:\/\/(?:127\.0\.0\.1|localhost):\d+/gu, "")
    .replace(/\/v1\/checkpoint\/[^/]+\/async/u, "/v1/checkpoint/<run>/async");
};

const normalizeScalar = (value: unknown): unknown => {
  if (typeof value === "string") {
    if (/^01[0-9A-HJKMNP-TV-Z]{24}$/u.test(value)) return "<event-id>";
    if (/^fixture-(native|effect)-/u.test(value)) return value.replace(/^fixture-(native|effect)-/u, "fixture-");
    if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value)) return "<timestamp>";
    return normalizeUrl(value);
  }
  return value;
};

const normalizeValue = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(normalizeValue);
  if (!isObject(value)) return normalizeScalar(value);

  const normalized: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value)) {
    normalized[key] = normalizeValue(child);
  }

  for (const key of ["job_id", "qi_id", "request_id", "run_id", "fn_id"]) {
    if (normalized[key] !== undefined) normalized[key] = `<${key}>`;
  }
  if (normalized.request_started_at !== undefined) normalized.request_started_at = "<request_started_at>";
  if (normalized.ts !== undefined) normalized.ts = "<event-ts>";
  if (normalized.timestamp !== undefined) normalized.timestamp = "<timestamp>";
  if (typeof normalized.stack === "string") normalized.stack = "<stack>";
  if (typeof normalized.eventId === "string") normalized.eventId = "<event-id>";
  if (normalized.randomValue !== undefined) normalized.randomValue = "<random-value>";
  if (normalized.sync_id !== undefined) normalized.sync_id = "<sync-id>";
  if (normalized.app_id !== undefined) normalized.app_id = "<app-id>";
  if (normalized.sdk !== undefined) normalized.sdk = "<sdk>";

  if (isTimingObject(normalized)) return "present";
  if (typeof normalized.op === "string") return normalizeOpcode(normalized);
  if (isErrorObject(normalized)) {
    return sortObject({
      message: toJson(normalized.message),
      name: "<error-name>",
      stack: "<stack>",
    });
  }
  if (normalized.displayName === "capture-time" && typeof normalized.data === "number") {
    normalized.data = "<timestamp>";
  }
  if (normalized.displayName === "capture-random" && typeof normalized.data === "number") {
    normalized.data = "<random-value>";
  }
  if (Object.values(normalized).every((child) => child === null || isObject(child))) {
    for (const [key, child] of Object.entries(normalized)) {
      if (/^[a-f0-9]{40}$/u.test(key) && isObject(child) && typeof child.data === "number") {
        normalized[key] = { ...child, data: "<dynamic-number>" };
      }
    }
  }
  return normalized;
};

const normalizeOpcode = (opcode: Record<string, unknown>): Record<string, unknown> => {
  const normalized: Record<string, unknown> = {
    op: opcode.op,
    ...(opcode.id ? { id: opcode.id } : {}),
    ...(opcode.name ? { name: opcode.name } : {}),
    ...(opcode.displayName ? { displayName: opcode.displayName } : {}),
  };
  if (opcode.op !== "StepError" && opcode.op !== "StepFailed") {
    if (opcode.opts !== undefined) normalized.opts = opcode.opts;
    if (opcode.userland !== undefined) normalized.userland = opcode.userland;
    if (opcode.timing !== undefined) normalized.timing = opcode.timing;
  }
  if (opcode.data !== undefined && opcode.data !== null) normalized.data = opcode.data;
  if (opcode.error !== undefined) normalized.error = opcode.error;
  if (opcode.mode !== undefined) normalized.mode = opcode.mode;
  return sortObject(toJson(normalized) as Record<string, Json>);
};

const isTimingObject = (value: Record<string, unknown>) =>
  Object.keys(value).length === 2 && typeof value.a === "number" && typeof value.b === "number";

const isErrorObject = (value: Record<string, unknown>) =>
  typeof value.name === "string" && typeof value.message === "string" && typeof value.stack === "string";

const requestBody = (exchange: ObservedExchange) => exchange.request.body;
const responseBody = (exchange: ObservedExchange) => exchange.response.body;
const requestPath = (exchange: ObservedExchange) => String(exchange.request.path ?? "");
const requestMethod = (exchange: ObservedExchange) => String(exchange.request.method ?? "");
const requestQuery = (exchange: ObservedExchange) => (isObject(exchange.request.query) ? exchange.request.query : {});
const responseHeaders = (exchange: ObservedExchange) =>
  isObject(exchange.response.headers) ? exchange.response.headers : {};

const canonicalExchangeBody = (exchange: ObservedExchange): Json =>
  toJson(
    removeKeys(
      normalizeValue({
        request: {
          method: exchange.request.method,
          path: exchange.request.path,
          query: exchange.request.query,
          body: requestBody(exchange),
        },
        response: {
          status: exchange.response.status,
          headers: responseHeaders(exchange),
          body: responseBody(exchange),
        },
      }),
      new Set(["sequence", "authorization", "user-agent", "x-inngest-sdk", "date", "checkpoint"]),
    ),
  );

const registration = (exchanges: ReadonlyArray<ObservedExchange>) => {
  const introspection = exchanges.find(
    (exchange) => exchange.direction === "inbound" && requestMethod(exchange) === "GET",
  );
  const sync = exchanges.find((exchange) => exchange.direction === "inbound" && requestMethod(exchange) === "PUT");
  const register = exchanges.find(
    (exchange) => exchange.direction === "outbound" && requestPath(exchange) === "/fn/register",
  );
  return {
    ...(introspection ? { introspection: canonicalExchangeBody(introspection) } : {}),
    ...(sync ? { sync: canonicalExchangeBody(sync) } : {}),
    ...(register ? { register: canonicalExchangeBody(register) } : {}),
  };
};

const canonicalEvent = (event: Record<string, unknown>): Json =>
  toJson(
    normalizeValue({
      name: event.name,
      data: event.data ?? {},
      ...(event.id ? { id: event.id } : {}),
    }),
  );

const caseEvents = (example: ExampleManifestEntry): ReadonlyArray<Json> =>
  example.cases.flatMap((exampleCase) => {
    if (exampleCase.kind !== "event") return [];
    const primary = exampleCase.events.map(canonicalEvent);
    const delayed = (exampleCase.afterEvents ?? []).flatMap((afterEvent) => afterEvent.events.map(canonicalEvent));
    return exampleCase.expect?.length === 0 ? [...primary, ...delayed] : [...primary, ...delayed];
  });

const sentEvents = (exchanges: ReadonlyArray<ObservedExchange>): ReadonlyArray<Json> =>
  exchanges.flatMap((exchange) => {
    if (
      exchange.direction !== "outbound" ||
      requestMethod(exchange) !== "POST" ||
      !requestPath(exchange).startsWith("/e/")
    ) {
      return [];
    }
    const body = requestBody(exchange);
    const events = Array.isArray(body) ? body : [body];
    return events.filter(isObject).map(canonicalEvent);
  });

const hasRetryAfter = (exchange: ObservedExchange) => responseHeaders(exchange)["retry-after"] !== undefined;

const canonicalExecutionResponse = (exchange: ObservedExchange) => {
  const body = responseBody(exchange);
  if (Array.isArray(body) && body.length === 1 && isObject(body[0]) && body[0].op === "RunComplete") {
    return {
      status: "complete",
      data: body[0].data,
    };
  }
  if (exchange.response.status === 200 && isObject(body)) {
    return {
      status: "complete",
      data: body,
    };
  }
  return {
    status: exchange.response.status,
    ...(hasRetryAfter(exchange) ? { retryAfter: responseHeaders(exchange)["retry-after"] } : {}),
    body,
  };
};

const batchEvents = (body: unknown): ReadonlyArray<unknown> | undefined => {
  if (!isObject(body) || !Array.isArray(body.events)) return undefined;
  return stableSort(body.events, JSON.stringify);
};

const eventForExecution = (body: unknown, events: ReadonlyArray<unknown> | undefined) => {
  if (!isObject(body)) return undefined;
  if (!events || !isObject(body.event)) return body.event;
  return {
    name: body.event.name,
  };
};

const responseForExecution = (exchange: ObservedExchange, events: ReadonlyArray<unknown> | undefined) => {
  const response = canonicalExecutionResponse(exchange);
  if (!events || !isObject(response.data)) return response;
  const data = response.data;
  if (!Array.isArray(data.items) || !data.items.every((item) => typeof item === "string")) return response;
  return {
    ...response,
    data: {
      ...data,
      items: stableSort(data.items, String),
    },
  };
};

const canonicalExecution = (exchange: ObservedExchange): Json => {
  const body = requestBody(exchange);
  const ctx = isObject(body) && isObject(body.ctx) ? body.ctx : {};
  const query = requestQuery(exchange);
  const stack = isObject(ctx.stack) && Array.isArray(ctx.stack.stack) ? ctx.stack.stack : [];
  const events = batchEvents(body);
  return toJson(
    normalizeValue({
      functionId: query.fnId,
      stepId: query.stepId,
      kind: query.stepId === "step" ? (stack.length === 0 ? "root" : "continuation") : "parallel-child",
      attempt: ctx.attempt ?? 0,
      generation: ctx.generation_id ?? 0,
      event: eventForExecution(body, events),
      batchEvents: events,
      stack,
      memoizedSteps: isObject(body) ? body.steps : undefined,
      response: responseForExecution(exchange, events),
    }),
  );
};

const executionSortKey = (execution: Json) => JSON.stringify(execution);

const isRetryContinuationError = (exchange: ObservedExchange) => {
  const body = requestBody(exchange);
  const ctx = isObject(body) && isObject(body.ctx) ? body.ctx : {};
  const stack = isObject(ctx.stack) && Array.isArray(ctx.stack.stack) ? ctx.stack.stack : [];
  return requestQuery(exchange).stepId === "step" && stack.length > 0 && exchange.response.status === 400;
};

const executions = (exchanges: ReadonlyArray<ObservedExchange>): ReadonlyArray<Json> =>
  stableSort(
    exchanges
      .filter(
        (exchange) =>
          exchange.direction === "inbound" &&
          requestMethod(exchange) === "POST" &&
          requestPath(exchange).startsWith("/examples/") &&
          requestQuery(exchange).fnId !== undefined &&
          !isRetryContinuationError(exchange),
      )
      .map(canonicalExecution),
    executionSortKey,
  );

const checkpoints = (exchanges: ReadonlyArray<ObservedExchange>): ReadonlyArray<Json> =>
  stableSort(
    exchanges
      .filter(
        (exchange) =>
          exchange.direction === "outbound" &&
          requestMethod(exchange) === "POST" &&
          requestPath(exchange).startsWith("/v1/checkpoint/"),
      )
      .map(canonicalExchangeBody),
    JSON.stringify,
  );

export const toCanonicalFixture = (args: {
  readonly example: ExampleManifestEntry;
  readonly runtime: RuntimeName;
  readonly exchanges: ReadonlyArray<ObservedExchange>;
}): CanonicalFixture => {
  const eventInputs = caseEvents(args.example);
  const emittedEvents = sentEvents(args.exchanges);
  return {
    schema: "inngest-protocol-canonical/v1",
    exampleId: args.example.id,
    runtime: args.runtime,
    registration: registration(args.exchanges),
    events: stableSort([...eventInputs, ...emittedEvents], JSON.stringify),
    executions: executions(args.exchanges),
    checkpoints: checkpoints(args.exchanges),
  };
};
