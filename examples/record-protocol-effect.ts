/// <reference types="bun" />

import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { BunHttpClient, BunRuntime, BunServices } from "@effect/platform-bun";
import { Command, Flag } from "effect/unstable/cli";
import { HttpClient, HttpClientRequest, HttpMethod } from "effect/unstable/http";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Ref from "effect/Ref";
import * as Stream from "effect/Stream";

type RuntimeName = "native" | "effect";
type RuntimeArg = RuntimeName | "both";
type Direction = "inbound" | "outbound";

interface ExampleCase {
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

interface ExampleManifestEntry {
  readonly id: string;
  readonly path?: string;
  readonly cases: ReadonlyArray<ExampleCase>;
}

interface HttpResult {
  readonly body: string;
  readonly status: number;
}

interface ProcessHandle {
  readonly handle: ChildProcessSpawner.ChildProcessHandle;
  readonly getOutput: Effect.Effect<string>;
  readonly label: string;
  readonly output: Ref.Ref<string>;
}

interface Exchange {
  readonly sequence: number;
  readonly direction: Direction;
  readonly proxy: string;
  readonly request: Record<string, unknown>;
  readonly response: Record<string, unknown>;
}

interface RecordingState {
  readonly exchanges: Ref.Ref<Map<string, ReadonlyArray<Exchange>>>;
  readonly inFlight: Ref.Ref<number>;
  readonly idle: Ref.Ref<Deferred.Deferred<void>>;
  readonly runToExample: Ref.Ref<Map<string, string>>;
  readonly sequence: Ref.Ref<number>;
  readonly sequences: Ref.Ref<Map<string, number>>;
}

const examplesDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(examplesDir, "..");
const fixturesRoot = join(examplesDir, "fixtures");

const realDevOrigin = "http://127.0.0.1:8288";
const recordedDevOrigin = "http://127.0.0.1:18289";
const recordedSdkOrigin = "http://127.0.0.1:19998";
const realSdkOrigin = "http://127.0.0.1:19999";

const examplePath = (exampleId: string) => `/examples/${exampleId}`;
const sdkUrlFor = (exampleId: string) => `${recordedSdkOrigin}${examplePath(exampleId)}`;
const appIdFor = (exampleId: string) => `examples-${exampleId}`;

const runtimes = {
  effect: {
    label: "effect-inngest",
    manifestPath: "/__effect/examples",
    serverFile: join(examplesDir, "effect-server.ts"),
    env: (example?: ExampleManifestEntry) => ({
      EFFECT_INNGEST_DEV_URL: recordedDevOrigin,
      EFFECT_INNGEST_EXAMPLE_IDS: example?.id ?? "",
      EFFECT_INNGEST_FRAMEWORK: "bun",
      EFFECT_INNGEST_PORT: "19999",
      EFFECT_INNGEST_SERVE_ORIGIN: recordedSdkOrigin,
    }),
  },
  native: {
    label: "native inngest-js",
    manifestPath: "/__native/examples",
    serverFile: join(examplesDir, "native", "server.ts"),
    env: (example?: ExampleManifestEntry) => ({
      NATIVE_INNGEST_BASE_URL: recordedDevOrigin,
      NATIVE_INNGEST_EXAMPLE_IDS: example?.id ?? "",
      NATIVE_INNGEST_PORT: "19999",
      NATIVE_INNGEST_SERVE_ORIGIN: recordedSdkOrigin,
      ...(example
        ? { NATIVE_INNGEST_APP_ID: appIdFor(example.id), NATIVE_INNGEST_SERVE_PATH: examplePath(example.id) }
        : {}),
    }),
  },
} as const;

const makeState = Effect.gen(function* () {
  const idle = yield* Deferred.make<void>();
  yield* Deferred.succeed(idle, undefined);
  return {
    exchanges: yield* Ref.make(new Map<string, ReadonlyArray<Exchange>>()),
    inFlight: yield* Ref.make(0),
    idle: yield* Ref.make(idle),
    runToExample: yield* Ref.make(new Map<string, string>()),
    sequence: yield* Ref.make(0),
    sequences: yield* Ref.make(new Map<string, number>()),
  } satisfies RecordingState;
});

const resetExampleState = (state: RecordingState, exampleId: string) =>
  Effect.gen(function* () {
    yield* Ref.update(state.exchanges, (exchanges) => new Map(exchanges).set(exampleId, []));
    yield* Ref.update(state.sequences, (sequences) => new Map(sequences).set(exampleId, 0));
    yield* Ref.update(state.runToExample, (runs) => {
      const next = new Map(runs);
      for (const [runId, owner] of next) {
        if (owner === exampleId) next.delete(runId);
      }
      return next;
    });
  });

const delay = (ms: number) =>
  Effect.timeoutOrElse(Effect.never, {
    duration: `${ms} millis`,
    orElse: () => Effect.void,
  });

const withDeadline = <A, E, R>(effect: Effect.Effect<A, E, R>, ms: number, message: string) =>
  Effect.raceFirst(effect, delay(ms).pipe(Effect.flatMap(() => Effect.fail(new Error(message)))));

const markRequestStart = (state: RecordingState) =>
  Effect.gen(function* () {
    const next = yield* Ref.updateAndGet(state.inFlight, (n) => n + 1);
    if (next === 1) {
      yield* Ref.set(state.idle, yield* Deferred.make<void>());
    }
    return yield* Ref.updateAndGet(state.sequence, (n) => n + 1);
  });

const nextExampleSequence = (state: RecordingState, exampleId: string) =>
  Ref.modify(state.sequences, (sequences) => {
    const current = sequences.get(exampleId) ?? 0;
    return [current + 1, new Map(sequences).set(exampleId, current + 1)] as const;
  });

const exampleIdFromPath = (path: string) => path.match(/^\/examples\/([^/]+)/u)?.[1];

const appNameToExampleId = (appName: unknown) =>
  typeof appName === "string" && appName.startsWith("examples-") ? appName.slice("examples-".length) : undefined;

const rawBodyRunId = (body: unknown) => (isObject(body) && typeof body.run_id === "string" ? body.run_id : undefined);

const rawBodyCtxRunId = (body: unknown) => {
  if (!isObject(body) || !isObject(body.ctx) || typeof body.ctx.run_id !== "string") return undefined;
  return body.ctx.run_id;
};

const identifyExchangeExample = (state: RecordingState, direction: Direction, path: string, body: unknown) =>
  Effect.gen(function* () {
    if (direction === "inbound") {
      const exampleId = exampleIdFromPath(path);
      const runId = rawBodyCtxRunId(body);
      if (exampleId && runId) {
        yield* Ref.update(state.runToExample, (runs) => new Map(runs).set(runId, exampleId));
      }
      return exampleId;
    }

    if (path === "/fn/register" && isObject(body)) {
      return appNameToExampleId(body.appName);
    }

    const checkpointRunId = rawBodyRunId(body);
    if (checkpointRunId) {
      return (yield* Ref.get(state.runToExample)).get(checkpointRunId);
    }

    return undefined;
  });

const appendExchange = (state: RecordingState, exampleId: string, exchange: Exchange) =>
  Ref.update(state.exchanges, (all) => {
    const next = new Map(all);
    next.set(exampleId, [...(next.get(exampleId) ?? []), exchange]);
    return next;
  });

const markRequestEnd = (state: RecordingState) =>
  Effect.gen(function* () {
    const next = yield* Ref.updateAndGet(state.inFlight, (n) => Math.max(0, n - 1));
    if (next === 0) {
      yield* Deferred.succeed(yield* Ref.get(state.idle), undefined);
    }
  });

const waitForNetworkIdle = (state: RecordingState) =>
  Effect.gen(function* () {
    const count = yield* Ref.get(state.inFlight);
    if (count === 0) return;
    yield* Deferred.await(yield* Ref.get(state.idle));
  });

const parseBody = (text: string): unknown => {
  if (!text) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
};

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const sanitizePath = (path: string): string =>
  path.replace(/\/v1\/checkpoint\/[^/]+\/async/u, "/v1/checkpoint/<run_id>/async");

const sanitizeUrl = (url: string): string =>
  url.replace(/\/v1\/checkpoint\/[^/]+\/async/u, "/v1/checkpoint/<run_id>/async");

const orderObject = (value: Record<string, unknown>, keys: ReadonlyArray<string>): Record<string, unknown> => {
  const ordered: Record<string, unknown> = {};
  for (const key of keys) {
    if (Object.hasOwn(value, key)) ordered[key] = canonicalizeProtocolValue(value[key]);
  }
  for (const [key, child] of Object.entries(value)) {
    if (!Object.hasOwn(ordered, key)) ordered[key] = canonicalizeProtocolValue(child);
  }
  return ordered;
};

const opcodeKeyOrder = (value: Record<string, unknown>) => {
  if (value.op === "StepPlanned") return ["displayName", "op", "id", "name", "opts", "userland", "data"];
  if (value.op === "StepRun" && Object.hasOwn(value, "rawArgs")) {
    return [
      "id",
      "mode",
      "op",
      "name",
      "displayName",
      "userland",
      "opts",
      "rawArgs",
      "hashedId",
      "promise",
      "fulfilled",
      "hasStepState",
      "handled",
      "middleware",
      "memoizationDeferred",
      "transformedResultPromise",
      "data",
      "timing",
    ];
  }
  if (value.op === "StepRun") return ["id", "op", "name", "opts", "displayName", "userland", "data", "timing"];
  if (value.op === "RunComplete") return ["op", "id", "data"];
  if (value.op === "InvokeFunction") return ["id", "op", "displayName", "mode", "opts", "userland", "data"];
  if (value.op === "WaitForEvent") return ["id", "op", "name", "displayName", "mode", "opts"];
  if (value.op === "Sleep") return ["id", "op", "name", "displayName", "mode", "opts"];
  if (value.op === "StepError" || value.op === "StepFailed")
    return ["id", "op", "name", "displayName", "error", "data"];
  return ["op", "id", "name", "displayName", "mode", "opts", "userland", "data", "error", "timing"];
};

const canonicalizeProtocolValue = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(canonicalizeProtocolValue);
  if (!isObject(value)) return value;

  if (Object.hasOwn(value, "a") && Object.hasOwn(value, "b") && Object.keys(value).length === 2) {
    return orderObject({ ...value, a: "<timing-a>" }, ["a", "b"]);
  }

  if (typeof value.op === "string") return orderObject(value, opcodeKeyOrder(value));
  if (Array.isArray(value.steps) && Object.hasOwn(value, "run_id")) {
    return orderObject(value, [
      "run_id",
      "fn_id",
      "qi_id",
      "request_id",
      "generation_id",
      "request_started_at",
      "steps",
      "ts",
    ]);
  }
  if (Object.hasOwn(value, "stepInfo")) return orderObject(value, ["stepInfo"]);
  if (Object.hasOwn(value, "hashedId") && Object.hasOwn(value, "stepType")) {
    return orderObject(value, ["hashedId", "memoized", "options", "stepType"]);
  }
  if (Object.hasOwn(value, "id") && Object.hasOwn(value, "name") && Object.keys(value).length === 2) {
    return orderObject(value, ["id", "name"]);
  }
  return orderObject(value, []);
};

const sanitizeVolatileProtocolFields = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(sanitizeVolatileProtocolFields);
  if (!isObject(value)) return value;

  const sanitized: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value)) {
    sanitized[key] = sanitizeVolatileProtocolFields(child);
  }

  for (const key of ["job_id", "qi_id", "request_id", "run_id"]) {
    if (sanitized[key] !== undefined) sanitized[key] = `<${key}>`;
  }
  if (sanitized.request_started_at !== undefined) sanitized.request_started_at = "<request_started_at>";
  if (sanitized.ts !== undefined) sanitized.ts = "<event-ts>";
  if (sanitized.timestamp !== undefined) sanitized.timestamp = "<timestamp>";
  if (sanitized.correlation_id !== undefined) sanitized.correlation_id = "<correlation_id>";
  if (sanitized.expire !== undefined) sanitized.expire = "<expire>";
  if (sanitized.gid !== undefined) sanitized.gid = "<gid>";
  if (sanitized.dsid !== undefined) sanitized.dsid = "<dsid>";
  if (sanitized.dstp !== undefined) sanitized.dstp = "<dstp>";
  if (sanitized.tp !== undefined) sanitized.tp = "<traceparent>";
  if (sanitized.traceparent !== undefined) sanitized.traceparent = "<traceparent>";

  return sanitized;
};

const sanitizeEventBody = (event: unknown): unknown => {
  if (!isObject(event)) return event;
  return {
    ...event,
    ...(event.id !== undefined ? { id: "<event-id>" } : {}),
    ...(event.ts !== undefined ? { ts: "<event-ts>" } : {}),
  };
};

const sanitizeProtocolBody = (body: unknown): unknown => {
  if (Array.isArray(body)) return canonicalizeProtocolValue(sanitizeVolatileProtocolFields(body));
  if (!isObject(body)) return body;

  const sanitized = sanitizeVolatileProtocolFields(body) as Record<string, unknown>;
  if (sanitized.sync_id !== undefined) sanitized.sync_id = "<sync-id>";
  if (sanitized.sdk !== undefined) sanitized.sdk = "<sdk>";
  if (sanitized.event) sanitized.event = sanitizeEventBody(sanitized.event);
  if (Array.isArray(sanitized.events)) sanitized.events = sanitized.events.map(sanitizeEventBody);
  return canonicalizeProtocolValue(sanitized);
};

const omittedHeaders = new Set([
  "accept",
  "accept-encoding",
  "accept-language",
  "b3",
  "connection",
  "content-length",
  "date",
  "host",
  "sec-fetch-mode",
  "server-timing",
  "traceparent",
  "tracestate",
  "vary",
  "x-inngest-job-id",
  "x-request-id",
  "x-run-id",
]);

const sanitizeHeaders = (headers: Record<string, string>): Record<string, string> =>
  Object.fromEntries(
    Object.entries(headers)
      .filter(([key, value]) => value !== undefined && !omittedHeaders.has(key.toLowerCase()))
      .map(([key, value]) => {
        const lowerKey = key.toLowerCase();
        const valueToRecord = ["authorization", "cookie", "set-cookie", "x-inngest-signature"].includes(lowerKey)
          ? "<redacted>"
          : ["user-agent", "x-inngest-sdk"].includes(lowerKey)
            ? "<sdk>"
            : value;
        return [lowerKey, valueToRecord];
      })
      .sort((left, right) => String(left[0]).localeCompare(String(right[0]))),
  );

const requestBody = (request: Request) =>
  ["GET", "HEAD"].includes(request.method) ? Effect.succeed("") : Effect.tryPromise(() => request.clone().text());

const requestWithMethod = (method: HttpMethod.HttpMethod, url: string) => {
  switch (method) {
    case "DELETE":
      return HttpClientRequest.delete(url);
    case "GET":
      return HttpClientRequest.get(url);
    case "HEAD":
      return HttpClientRequest.head(url);
    case "OPTIONS":
      return HttpClientRequest.options(url);
    case "PATCH":
      return HttpClientRequest.patch(url);
    case "POST":
      return HttpClientRequest.post(url);
    case "PUT":
      return HttpClientRequest.put(url);
    case "TRACE":
      return HttpClientRequest.trace(url);
    default:
      return method satisfies never;
  }
};

const responseHeaders = (headers: Record<string, string | undefined>) =>
  Object.fromEntries(Object.entries(headers).filter((entry): entry is [string, string] => entry[1] !== undefined));

const effectHttpRequest = (
  url: string,
  options: {
    readonly body?: string;
    readonly headers?: HeadersInit;
    readonly method?: string;
    readonly timeoutMs?: number;
  } = {},
) => {
  const method = options.method ?? "GET";
  if (!HttpMethod.isHttpMethod(method)) return Effect.fail(new Error(`Unsupported HTTP method ${method}`));
  const request = requestWithMethod(method, url).pipe(
    HttpClientRequest.setHeaders(Object.fromEntries(new Headers(options.headers).entries())),
    options.body !== undefined && HttpMethod.hasBody(method)
      ? HttpClientRequest.bodyText(options.body, new Headers(options.headers).get("content-type") ?? undefined)
      : (current: HttpClientRequest.HttpClientRequest) => current,
  );

  return HttpClient.execute(request).pipe(
    Effect.timeoutOrElse({
      duration: `${options.timeoutMs ?? 10_000} millis`,
      orElse: () => Effect.fail(new Error(`${method} ${url} timed out after ${options.timeoutMs ?? 10_000}ms`)),
    }),
  );
};

const recordProxy = (
  state: RecordingState,
  opts: {
    readonly direction: Direction;
    readonly name: string;
    readonly port: number;
    readonly proxyOrigin: string;
    readonly targetOrigin: string;
  },
) =>
  Effect.acquireRelease(
    Effect.gen(function* () {
      const httpClient = yield* HttpClient.HttpClient;
      const server = Bun.serve({
        hostname: "127.0.0.1",
        port: opts.port,
        fetch(request) {
          return Effect.runPromise(
            Effect.gen(function* () {
              yield* markRequestStart(state);
              try {
                const url = new URL(request.url);
                const targetUrl = `${opts.targetOrigin}${url.pathname}${url.search}`;
                const bodyText = yield* requestBody(request);
                const rawBody = parseBody(bodyText);
                const headers = new Headers(request.headers);
                headers.delete("content-length");
                headers.set("host", new URL(opts.targetOrigin).host);
                const exampleId = yield* identifyExchangeExample(state, opts.direction, url.pathname, rawBody);
                const localSequence = exampleId ? yield* nextExampleSequence(state, exampleId) : undefined;
                const requestRecord = {
                  ...(localSequence ? { sequence: localSequence } : {}),
                  method: request.method,
                  url: sanitizeUrl(`${opts.proxyOrigin}${url.pathname}${url.search}`),
                  path: sanitizePath(url.pathname),
                  query: Object.fromEntries(url.searchParams.entries()),
                  headers: sanitizeHeaders(Object.fromEntries(request.headers.entries())),
                  body: sanitizeProtocolBody(rawBody),
                };
                const upstream = yield* effectHttpRequest(targetUrl, {
                  body: bodyText ? bodyText : undefined,
                  headers,
                  method: request.method,
                }).pipe(Effect.provideService(HttpClient.HttpClient, httpClient));
                const responseText = yield* upstream.text;
                if (exampleId && localSequence) {
                  yield* appendExchange(state, exampleId, {
                    sequence: localSequence,
                    direction: opts.direction,
                    proxy: opts.name,
                    request: requestRecord,
                    response: {
                      status: upstream.status,
                      headers: sanitizeHeaders(responseHeaders(upstream.headers)),
                      body: sanitizeProtocolBody(parseBody(responseText)),
                    },
                  });
                }
                return new Response(responseText, {
                  headers: responseHeaders(upstream.headers),
                  status: upstream.status,
                });
              } finally {
                Effect.runSync(markRequestEnd(state));
              }
            }),
          ).catch((error: unknown) => {
            if (error instanceof Error && "code" in error && error.code === "ConnectionRefused") {
              return new Response("SDK server stopped", { status: 410 });
            }
            throw error;
          });
        },
      });
      console.log(`${opts.name} recorder listening on ${opts.proxyOrigin} -> ${opts.targetOrigin}`);
      return server;
    }),
    (server) => Effect.sync(() => server.stop(true)),
  );

const http = (
  url: string,
  options: {
    readonly body?: string;
    readonly headers?: HeadersInit;
    readonly method?: string;
    readonly timeoutMs?: number;
  } = {},
) => {
  return Effect.gen(function* () {
    const response = yield* effectHttpRequest(url, options);
    const body = yield* response.text;
    return { body, status: response.status } satisfies HttpResult;
  });
};

const json = (url: string, options?: Parameters<typeof http>[1]) =>
  Effect.gen(function* () {
    const response = yield* http(url, options);
    if (response.status < 200 || response.status >= 300) {
      return yield* Effect.fail(new Error(`${url} returned ${response.status}: ${response.body}`));
    }
    return JSON.parse(response.body) as unknown;
  });

const stopManaged = (handle: ProcessHandle | undefined) =>
  handle
    ? handle.handle.kill({ killSignal: "SIGTERM", forceKillAfter: "2 seconds" }).pipe(Effect.catch(() => Effect.void))
    : Effect.void;

const spawnManaged = (command: string, args: ReadonlyArray<string>, label: string, env: Record<string, string> = {}) =>
  Effect.acquireRelease(
    Effect.gen(function* () {
      const output = yield* Ref.make("");
      const handle = yield* ChildProcess.make(command, [...args], {
        cwd: repoRoot,
        env: { ...process.env, ...env, NO_COLOR: "1", NO_UPDATE_NOTIFIER: "1", NPM_CONFIG_UPDATE_NOTIFIER: "false" },
      });
      yield* handle.all.pipe(
        Stream.decodeText(),
        Stream.runForEach((chunk) => Ref.update(output, (current) => `${current}${chunk}`.slice(-20_000))),
        Effect.forkScoped,
      );
      return { handle, getOutput: Ref.get(output), label, output } satisfies ProcessHandle;
    }),
    (handle) => stopManaged(handle).pipe(Effect.catch(() => Effect.void)),
  );

const commandExists = (command: string) =>
  Effect.gen(function* () {
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
    const exitCode = yield* spawner.exitCode(ChildProcess.make("sh", ["-c", `command -v ${command} >/dev/null 2>&1`]));
    return exitCode === ChildProcessSpawner.ExitCode(0);
  }).pipe(Effect.catch(() => Effect.succeed(false)));

const cliPrefix = Effect.gen(function* () {
  if (process.env.INNGEST_CLI) return process.env.INNGEST_CLI.split(" ").filter(Boolean);
  if (yield* commandExists("inngest")) return ["inngest"];
  return ["npx", "--yes", "--ignore-scripts=false", "inngest-cli@latest"];
});

const waitForHttp = (url: string, timeoutMs: number, processHandle?: ProcessHandle) =>
  withDeadline(
    Effect.gen(function* () {
      while (true) {
        if (processHandle && !(yield* processHandle.handle.isRunning)) {
          return yield* Effect.fail(
            new Error(`${processHandle.label} exited early\n${yield* processHandle.getOutput}`),
          );
        }
        const result = yield* Effect.result(http(url, { timeoutMs: 1_000 }));
        if (result._tag === "Success" && result.success.status >= 200 && result.success.status < 300) return;
        yield* delay(250);
      }
    }),
    timeoutMs,
    `Timed out waiting for ${url}`,
  );

const startDevServer = Effect.gen(function* () {
  const existing = yield* Effect.result(http(`${realDevOrigin}/dev`, { timeoutMs: 1_000 }));
  if (existing._tag === "Success" && existing.success.status >= 200 && existing.success.status < 300) {
    console.log(`using existing Inngest dev server at ${realDevOrigin}`);
    return undefined;
  }
  const [command, ...prefixArgs] = yield* cliPrefix;
  if (!command) return yield* Effect.fail(new Error("Empty Inngest CLI command"));
  const devServer = yield* spawnManaged(
    command,
    [...prefixArgs, "dev", "--no-discovery", "--no-poll", "--port", "8288", "--retry-interval", "1", "--tick", "10"],
    "inngest dev server",
  );
  yield* waitForHttp(`${realDevOrigin}/dev`, 60_000, devServer);
  return devServer;
});

const startRuntimeServer = (runtimeName: RuntimeName, example?: ExampleManifestEntry) =>
  Effect.gen(function* () {
    const runtime = runtimes[runtimeName];
    const server = yield* spawnManaged("bun", [runtime.serverFile], `${runtime.label} harness`, runtime.env(example));
    yield* waitForHttp(`${realSdkOrigin}/health`, 20_000, server);
    return server;
  });

const assertOk = (label: string, response: HttpResult) =>
  response.status < 200 || response.status >= 300
    ? Effect.fail(new Error(`${label} failed with ${response.status}: ${response.body}`))
    : Effect.void;

const withFixtureIds = (exampleId: string, caseId: string | number, events: ReadonlyArray<Record<string, unknown>>) =>
  events.map((event, eventIndex) => ({
    ...event,
    id: event.id ?? `fixture-${exampleId}-${caseId}-${eventIndex}`,
  }));

const sendEvents = (eventKey: string, events: ReadonlyArray<Record<string, unknown>>) =>
  http(`${realDevOrigin}/e/${eventKey}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(events),
  }).pipe(Effect.flatMap((response) => assertOk(`send ${events.map((event) => event.name).join(", ")}`, response)));

const triggerCase = (
  runtimeName: RuntimeName,
  example: ExampleManifestEntry,
  caseData: ExampleCase,
  caseIndex: number,
) =>
  Effect.gen(function* () {
    if (caseData.kind !== "event") return yield* Effect.fail(new Error("Unsupported protocol fixture case kind"));
    const fixturePrefix = `${runtimeName}-${example.id}`;
    yield* sendEvents(caseData.eventKey ?? "local", withFixtureIds(fixturePrefix, caseIndex, caseData.events));
    for (const [afterIndex, afterEvent] of (caseData.afterEvents ?? []).entries()) {
      yield* delay(afterEvent.delayMs).pipe(
        Effect.flatMap(() =>
          sendEvents(
            afterEvent.eventKey ?? caseData.eventKey ?? "local",
            withFixtureIds(fixturePrefix, `${caseIndex}-after-${afterIndex}`, afterEvent.events),
          ),
        ),
        Effect.catch((error) => Effect.sync(() => console.error(`Failed follow-up events for ${example.id}:`, error))),
        Effect.forkScoped,
      );
    }
  });

const expectedExecutionCount = (example: ExampleManifestEntry) =>
  example.cases.reduce((total, caseData) => total + (caseData.expect?.length ?? 1), 0);

const expectedRuns = (example: ExampleManifestEntry) =>
  example.cases.flatMap((caseData) =>
    (caseData.expect ?? [{}]).map((expected) => ({
      functionId:
        expected.functionId ?? (expected.functionTag ? `examples-${example.id}-${expected.functionTag}` : undefined),
      status: expected.status,
    })),
  );

const allowsServerSideTerminalStatus = (status: string | ReadonlyArray<string> | undefined) => {
  const statuses = typeof status === "string" ? [status] : (status ?? []);
  return statuses.some((value) => value === "TIMED_OUT" || value === "CANCELLED" || value === "CANCELED");
};

const expectedTerminalExecutionCount = (example: ExampleManifestEntry) =>
  expectedRuns(example).filter((expected) => !allowsServerSideTerminalStatus(expected.status)).length;

const expectedRootFunctionIds = (example: ExampleManifestEntry) =>
  new Set(expectedRuns(example).flatMap((expected) => (expected.functionId ? [expected.functionId] : [])));

const hasTerminalOpcode = (body: unknown) =>
  Array.isArray(body) &&
  body.some(
    (op) =>
      isObject(op) &&
      typeof op.op === "string" &&
      (op.op === "RunComplete" || op.op === "SyncRunComplete" || op.op === "StepFailed"),
  );

const isTerminalExecutionResponse = (exchange: Exchange) =>
  exchange.response.status !== 206 || hasTerminalOpcode(exchange.response.body);

const terminalExecutionCount = (
  exchanges: ReadonlyArray<Exchange>,
  path: string,
  expectedFunctionIds: ReadonlySet<string>,
) =>
  exchanges.filter(
    (exchange) =>
      exchange.direction === "inbound" &&
      exchange.request.method === "POST" &&
      exchange.request.path === path &&
      (expectedFunctionIds.size === 0 || expectedFunctionIds.has(String((exchange.request.query as any)?.fnId))) &&
      (exchange.request.query as any)?.stepId === "step" &&
      isTerminalExecutionResponse(exchange),
  ).length;

const rootExecutionCount = (
  exchanges: ReadonlyArray<Exchange>,
  path: string,
  expectedFunctionIds: ReadonlySet<string>,
) =>
  exchanges.filter(
    (exchange) =>
      exchange.direction === "inbound" &&
      exchange.request.method === "POST" &&
      exchange.request.path === path &&
      (expectedFunctionIds.size === 0 || expectedFunctionIds.has(String((exchange.request.query as any)?.fnId))) &&
      (exchange.request.query as any)?.stepId === "step",
  ).length;

const waitForExpectedExecutionRecordings = (
  state: RecordingState,
  server: ProcessHandle,
  path: string,
  expectedFunctionIds: ReadonlySet<string>,
  expectedCount: number,
  expectedTerminalCount: number,
) =>
  Effect.gen(function* () {
    const exampleId = exampleIdFromPath(path);
    if (!exampleId) return yield* Effect.fail(new Error(`Cannot identify example from path ${path}`));
    const wait = Effect.gen(function* () {
      while (true) {
        if (!(yield* server.handle.isRunning)) {
          return yield* Effect.fail(new Error(`${server.label} exited early\n${yield* server.getOutput}`));
        }
        const exchanges = (yield* Ref.get(state.exchanges)).get(exampleId) ?? [];
        const rootCount = rootExecutionCount(exchanges, path, expectedFunctionIds);
        const terminalCount = terminalExecutionCount(exchanges, path, expectedFunctionIds);
        if (rootCount >= expectedCount && terminalCount >= expectedTerminalCount) return;
        yield* waitForNetworkIdle(state);
        yield* delay(100);
      }
    });

    yield* wait.pipe(
      Effect.timeoutOrElse({
        duration: "30 seconds",
        orElse: () =>
          Effect.gen(function* () {
            const exchanges = (yield* Ref.get(state.exchanges)).get(exampleId) ?? [];
            const observed = exchanges.map((exchange) => ({
              sequence: exchange.sequence,
              direction: exchange.direction,
              path: exchange.request.path,
              method: exchange.request.method,
              query: exchange.request.query,
              requestBody: exchange.request.body,
              status: exchange.response.status,
              body: exchange.response.body,
            }));
            return yield* Effect.fail(
              new Error(
                `Timed out waiting for ${expectedCount} expected execution recordings at ${path}\nObserved exchanges: ${JSON.stringify(observed, null, 2)}`,
              ),
            );
          }),
      }),
    );
  });

const removeSyncedApp = (sdkUrl: string) =>
  http(`${realDevOrigin}/fn/remove?url=${encodeURIComponent(sdkUrl)}`, { method: "DELETE", timeoutMs: 5_000 }).pipe(
    Effect.ignore,
  );

const fixtureFile = (exampleId: string, runtimeName: RuntimeName) =>
  join(fixturesRoot, exampleId, `${runtimeName}.json`);
const stepCompletionOrder = (exchange: Exchange) => (exchange.request.body as any)?.ctx?.stack?.stack ?? [];
const isRootParallelPlan = (exchange: Exchange) =>
  exchange.direction === "inbound" &&
  exchange.request.method === "POST" &&
  (exchange.request.query as any)?.stepId === "step" &&
  Array.isArray(exchange.response.body) &&
  exchange.response.body.length > 1 &&
  exchange.response.body.every((op: any) => op?.op === "StepPlanned" && typeof op.id === "string");
const isParallelChildRequest = (exchange: Exchange, orderByPath: Map<string, Map<string, number>>) =>
  exchange.direction === "inbound" &&
  exchange.request.method === "POST" &&
  typeof exchange.request.path === "string" &&
  typeof (exchange.request.query as any)?.stepId === "string" &&
  (exchange.request.query as any).stepId !== "step" &&
  orderByPath.has(exchange.request.path) &&
  stepCompletionOrder(exchange).length === 0;

const canonicalizeParallelChildOrder = (ordered: ReadonlyArray<Exchange>) => {
  const orderByPath = new Map<string, Map<string, number>>();
  for (const exchange of ordered) {
    if (isRootParallelPlan(exchange)) {
      orderByPath.set(
        exchange.request.path as string,
        new Map((exchange.response.body as ReadonlyArray<any>).map((op, index, ops) => [op.id, ops.length - index])),
      );
    }
  }
  if (orderByPath.size === 0) return ordered;
  const normalizeExchange = (exchange: Exchange): Exchange => {
    const order = orderByPath.get(exchange.request.path as string);
    const stack = stepCompletionOrder(exchange);
    if (!order || stack.length <= 1 || !stack.every((id: string) => order.has(id))) return exchange;
    return {
      ...exchange,
      request: {
        ...exchange.request,
        body: {
          ...(exchange.request.body as Record<string, unknown>),
          ctx: {
            ...((exchange.request.body as any).ctx as Record<string, unknown>),
            stack: {
              ...(exchange.request.body as any).ctx.stack,
              stack: [...stack].sort((a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0)),
            },
          },
        },
      },
    };
  };
  const canonical: Array<Exchange> = [];
  for (let index = 0; index < ordered.length; ) {
    const exchange = normalizeExchange(ordered[index]!);
    if (!isParallelChildRequest(exchange, orderByPath)) {
      canonical.push(exchange);
      index++;
      continue;
    }
    const path = exchange.request.path;
    const group: Array<Exchange> = [];
    while (
      index < ordered.length &&
      ordered[index]!.request.path === path &&
      isParallelChildRequest(ordered[index]!, orderByPath)
    ) {
      group.push(normalizeExchange(ordered[index]!));
      index++;
    }
    const order = orderByPath.get(path as string)!;
    canonical.push(
      ...group.sort(
        (a, b) => (order.get((a.request.query as any).stepId) ?? 0) - (order.get((b.request.query as any).stepId) ?? 0),
      ),
    );
  }
  return canonical.map((exchange, index) => ({
    ...exchange,
    sequence: index + 1,
    request: { ...exchange.request, sequence: index + 1 },
  }));
};

const writeFixture = (state: RecordingState, exampleId: string, runtimeName: RuntimeName) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const exchanges = (yield* Ref.get(state.exchanges)).get(exampleId) ?? [];
    const ordered = canonicalizeParallelChildOrder([...exchanges].sort((a, b) => a.sequence - b.sequence));
    const outputFile = fixtureFile(exampleId, runtimeName);
    yield* fs.makeDirectory(path.dirname(outputFile), { recursive: true });
    yield* fs.writeFileString(outputFile, `${JSON.stringify(ordered, null, 2)}\n`);
  });

const matchesFilters = (example: ExampleManifestEntry, filters: ReadonlyArray<string>) =>
  filters.length === 0 || filters.some((filter) => example.id.includes(filter) || example.path?.includes(filter));

const readExamples = (runtimeName: RuntimeName, filters: ReadonlyArray<string>) =>
  Effect.gen(function* () {
    const runtime = runtimes[runtimeName];
    const manifest = (yield* json(`${realSdkOrigin}${runtime.manifestPath}`)) as {
      readonly examples?: ReadonlyArray<ExampleManifestEntry>;
    };
    return (manifest.examples ?? []).filter((example) => matchesFilters(example, filters));
  });

const recordExample = (
  state: RecordingState,
  server: ProcessHandle,
  runtimeName: RuntimeName,
  example: ExampleManifestEntry,
) =>
  Effect.scoped(
    Effect.gen(function* () {
      yield* resetExampleState(state, example.id);
      const sdkUrl = sdkUrlFor(example.id);
      yield* removeSyncedApp(sdkUrl);
      yield* http(sdkUrl, { method: "GET" }).pipe(Effect.flatMap((response) => assertOk("introspection", response)));
      yield* http(sdkUrl, { method: "PUT" }).pipe(Effect.flatMap((response) => assertOk("sync", response)));
      yield* waitForNetworkIdle(state);
      for (const [caseIndex, caseData] of example.cases.entries()) {
        yield* triggerCase(runtimeName, example, caseData, caseIndex);
      }
      yield* waitForExpectedExecutionRecordings(
        state,
        server,
        examplePath(example.id),
        expectedRootFunctionIds(example),
        expectedExecutionCount(example),
        expectedTerminalExecutionCount(example),
      );
      yield* waitForNetworkIdle(state);
      yield* removeSyncedApp(sdkUrl);
      yield* waitForNetworkIdle(state);
      yield* writeFixture(state, example.id, runtimeName);
      const exchanges = (yield* Ref.get(state.exchanges)).get(example.id) ?? [];
      console.log(
        `recorded ${exchanges.length} ${runtimeName} HTTP exchanges to ${fixtureFile(example.id, runtimeName)}`,
      );
    }).pipe(Effect.ensuring(removeSyncedApp(sdkUrlFor(example.id)))),
  );

const selectedRuntimes = (runtime: RuntimeArg): ReadonlyArray<RuntimeName> =>
  runtime === "both" ? ["native", "effect"] : [runtime];

const program = (input: {
  readonly concurrency: number;
  readonly runtime: RuntimeArg;
  readonly only: ReadonlyArray<string>;
}) =>
  Effect.scoped(
    Effect.gen(function* () {
      const state = yield* makeState;
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      yield* fs.remove(path.join(examplesDir, "native", "fixtures"), { force: true, recursive: true });
      yield* fs.makeDirectory(fixturesRoot, { recursive: true });
      yield* recordProxy(state, {
        direction: "inbound",
        name: "inngest-to-sdk",
        port: 19998,
        proxyOrigin: recordedSdkOrigin,
        targetOrigin: realSdkOrigin,
      });
      yield* recordProxy(state, {
        direction: "outbound",
        name: "sdk-to-inngest",
        port: 18289,
        proxyOrigin: recordedDevOrigin,
        targetOrigin: realDevOrigin,
      });
      for (const runtimeName of selectedRuntimes(input.runtime)) {
        yield* Effect.scoped(
          Effect.gen(function* () {
            yield* startDevServer;
            const server = yield* startRuntimeServer(runtimeName);
            const examples = yield* readExamples(runtimeName, input.only);
            if (examples.length === 0) {
              console.log(`no ${runtimeName} examples matched`);
              return;
            }
            yield* Effect.forEach(examples, (example) => recordExample(state, server, runtimeName, example), {
              concurrency: input.concurrency,
              discard: true,
            });
          }),
        );
      }
    }),
  );

const command = Command.make(
  "record-protocol-effect",
  {
    concurrency: Flag.integer("concurrency").pipe(Flag.withDefault(4)),
    runtime: Flag.choice("runtime", ["both", "native", "effect"] as const).pipe(Flag.withDefault("both" as const)),
    only: Flag.string("only").pipe(
      Flag.between(0, Number.MAX_SAFE_INTEGER),
      Flag.withDefault([] as ReadonlyArray<string>),
    ),
  },
  ({ concurrency, runtime, only }) => program({ concurrency, runtime, only }),
);

const main = Command.run(command, { version: "0.0.0" }).pipe(
  Effect.provide(Layer.mergeAll(BunServices.layer, BunHttpClient.layer)),
);

BunRuntime.runMain(main, { disableErrorReporting: false });
