import { spawn, type ChildProcess } from "node:child_process";
import { readdirSync } from "node:fs";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { FetchHttpClient } from "effect/unstable/http";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { InngestClient, InngestGroup } from "effect-inngest";
import type { ExampleCase, ExampleDefinition, ExpectedRun } from "../examples/_support.ts";

const rootDir = new URL("..", import.meta.url).pathname;
const examplesDir = join(rootDir, "examples");
const defaultDevUrl = "http://127.0.0.1:8288";
const defaultSdkUrl = "http://127.0.0.1:9999/";
const terminalStatuses = new Set(["CANCELLED", "CANCELED", "COMPLETED", "FAILED", "TIMED_OUT"]);
const defaultEventKey = "test";

interface Args {
  readonly devUrl: string;
  readonly filters: ReadonlyArray<string>;
  readonly list: boolean;
  readonly localSdkUrl: string;
  readonly sdkUrl: string;
  readonly useExistingDevServer: boolean;
}

interface ManagedProcess {
  readonly child: ChildProcess;
  readonly label: string;
  getOutput: () => string;
}

interface HttpResponse {
  readonly body: string;
  readonly status: number;
}

interface LoadedExample {
  readonly file: string;
  readonly definition: ExampleDefinition;
}

interface RunnableExample extends LoadedExample {
  readonly appId: string;
  readonly localUrl: string;
  readonly sdkUrl: string;
  readonly dispose?: () => Promise<void>;
  readonly handler?: (request: Request) => Promise<Response>;
}

interface ResolvedExpectedRun extends Omit<ExpectedRun, "functionTag"> {
  readonly appId: string;
  readonly functionId: string;
}

const parseArgs = (): Args => {
  const filters: Array<string> = [];
  let devUrl = defaultDevUrl;
  let list = false;
  let localSdkUrl = defaultSdkUrl;
  let sdkUrl: string | undefined;
  let useExistingDevServer = false;

  for (let i = 2; i < process.argv.length; i++) {
    const arg = process.argv[i];
    if (arg === "--list") {
      list = true;
    } else if (arg === "--use-existing-dev-server") {
      useExistingDevServer = true;
    } else if (arg === "--dev-url") {
      devUrl = process.argv[++i] ?? devUrl;
    } else if (arg === "--local-sdk-url") {
      localSdkUrl = process.argv[++i] ?? localSdkUrl;
    } else if (arg === "--sdk-url") {
      sdkUrl = process.argv[++i] ?? sdkUrl;
    } else if (arg === "--filter" || arg === "--only") {
      const filter = process.argv[++i];
      if (!filter) {
        throw new Error(`${arg} requires a value`);
      }
      filters.push(filter);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return {
    devUrl: normalizeUrl(devUrl, "strip-trailing-slash"),
    filters,
    list,
    localSdkUrl: normalizeUrl(localSdkUrl, "keep-trailing-slash"),
    sdkUrl: normalizeUrl(sdkUrl ?? localSdkUrl, "keep-trailing-slash"),
    useExistingDevServer,
  };
};

const normalizeUrl = (url: string, trailingSlash: "keep-trailing-slash" | "strip-trailing-slash"): string => {
  const normalized = url.replace(/\/+$/, "");
  return trailingSlash === "keep-trailing-slash" ? `${normalized}/` : normalized;
};

const cliPrefix = async (): Promise<ReadonlyArray<string>> => {
  if (process.env.INNGEST_CLI) {
    return process.env.INNGEST_CLI.split(" ").filter(Boolean);
  }

  if (await commandExists("inngest")) {
    return ["inngest"];
  }

  return ["npx", "--yes", "--ignore-scripts=false", "inngest-cli@latest"];
};

const commandExists = (command: string): Promise<boolean> =>
  new Promise((resolve) => {
    const child = spawn("sh", ["-c", `command -v ${command} >/dev/null 2>&1`], { stdio: "ignore" });
    child.on("exit", (code) => resolve(code === 0));
    child.on("error", () => resolve(false));
  });

const spawnManaged = (command: string, args: ReadonlyArray<string>, label: string): ManagedProcess => {
  let output = "";
  const child = spawn(command, args, {
    cwd: rootDir,
    detached: true,
    env: {
      ...process.env,
      NO_COLOR: "1",
      NO_UPDATE_NOTIFIER: "1",
      NPM_CONFIG_UPDATE_NOTIFIER: "false",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  const append = (chunk: Buffer) => {
    output = `${output}${chunk.toString()}`.slice(-20_000);
  };

  child.stdout.on("data", append);
  child.stderr.on("data", append);

  return { child, label, getOutput: () => output };
};

const stopManaged = async (processHandle: ManagedProcess | undefined): Promise<void> => {
  if (!processHandle || processHandle.child.exitCode !== null) {
    return;
  }

  const pid = processHandle.child.pid;
  if (!pid) {
    return;
  }

  try {
    globalThis.process.kill(-pid, "SIGTERM");
  } catch {
    try {
      processHandle.child.kill("SIGTERM");
    } catch {
      return;
    }
  }

  await Promise.race([
    onceExit(processHandle.child),
    sleep(5_000).then(() => {
      try {
        globalThis.process.kill(-pid, "SIGKILL");
      } catch {
        processHandle.child.kill("SIGKILL");
      }
    }),
  ]);
};

const onceExit = (child: ChildProcess): Promise<void> =>
  new Promise((resolve) => {
    if (child.exitCode !== null) {
      resolve();
      return;
    }
    child.once("exit", () => resolve());
  });

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const withTimeout = async <A>(promise: Promise<A>, timeoutMs: number, label: string): Promise<A> => {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms`)), timeoutMs);
      }),
    ]);
  } finally {
    if (timeout) {
      clearTimeout(timeout);
    }
  }
};

const http = (
  url: string,
  options: {
    readonly body?: string;
    readonly headers?: Record<string, string>;
    readonly method?: string;
    readonly timeoutMs?: number;
  } = {},
): Promise<HttpResponse> =>
  new Promise((resolve, reject) => {
    const target = new URL(url);
    const request = (target.protocol === "https:" ? httpsRequest : httpRequest)(
      target,
      {
        headers: options.headers,
        method: options.method ?? "GET",
        timeout: options.timeoutMs ?? 10_000,
      },
      (response) => {
        const chunks: Array<Buffer> = [];
        response.on("data", (chunk: Buffer) => chunks.push(chunk));
        response.on("end", () => {
          resolve({ body: Buffer.concat(chunks).toString(), status: response.statusCode ?? 0 });
        });
      },
    );

    request.on("error", reject);
    request.on("timeout", () => {
      request.destroy(new Error(`HTTP request timed out: ${url}`));
    });
    if (options.body) {
      request.write(options.body);
    }
    request.end();
  });

const canFetchDev = async (devUrl: string): Promise<boolean> => {
  try {
    const response = await http(`${devUrl}/dev`, { timeoutMs: 1_000 });
    return response.status >= 200 && response.status < 300;
  } catch {
    return false;
  }
};

const waitForHttp = async (url: string, timeoutMs: number, processHandle?: ManagedProcess): Promise<void> => {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;

  while (Date.now() < deadline) {
    if (processHandle && processHandle.child.exitCode !== null) {
      throw new Error(`${processHandle.label} exited early\n${processHandle.getOutput()}`);
    }

    try {
      const response = await http(url, { timeoutMs: 1_000 });
      if (response.status >= 200 && response.status < 300) {
        return;
      }
      lastError = new Error(`${url} returned ${response.status}`);
    } catch (error) {
      lastError = error;
    }

    await sleep(250);
  }

  throw new Error(
    `Timed out waiting for ${url}: ${String(lastError)}${processHandle ? `\n${processHandle.getOutput()}` : ""}`,
  );
};

const runCommand = async (command: string, args: ReadonlyArray<string>, timeoutMs = 30_000): Promise<string> =>
  new Promise((resolve, reject) => {
    let stdout = "";
    let stderr = "";
    const child = spawn(command, args, {
      cwd: rootDir,
      env: {
        ...process.env,
        NO_COLOR: "1",
        NO_UPDATE_NOTIFIER: "1",
        NPM_CONFIG_UPDATE_NOTIFIER: "false",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    const timeout = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`Command timed out: ${command} ${args.join(" ")}`));
    }, timeoutMs);

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.on("exit", (code) => {
      clearTimeout(timeout);
      if (code === 0) {
        resolve(stdout);
      } else {
        reject(new Error(`Command failed (${code}): ${command} ${args.join(" ")}\n${stderr}\n${stdout}`));
      }
    });
  });

const cliJson = async (
  cli: ReadonlyArray<string>,
  args: ReadonlyArray<string>,
  timeoutMs = 30_000,
): Promise<unknown> => {
  const [command, ...prefixArgs] = cli;
  if (!command) {
    throw new Error("Empty Inngest CLI command");
  }

  const stdout = await runCommand(command, [...prefixArgs, ...args], timeoutMs);
  try {
    return JSON.parse(stdout);
  } catch (error) {
    throw new Error(`Failed to parse CLI JSON: ${String(error)}\n${stdout}`);
  }
};

const startDevServer = async (args: Args, cli: ReadonlyArray<string>): Promise<ManagedProcess | undefined> => {
  if (args.useExistingDevServer) {
    await waitForHttp(`${args.devUrl}/dev`, 10_000);
    return undefined;
  }

  if (await canFetchDev(args.devUrl)) {
    throw new Error(
      `${args.devUrl} is already serving an Inngest dev server. Stop it first, or pass --use-existing-dev-server to reuse it intentionally.`,
    );
  }

  const [command, ...prefixArgs] = cli;
  if (!command) {
    throw new Error("Empty Inngest CLI command");
  }

  const url = new URL(args.devUrl);
  const devServer = spawnManaged(
    command,
    [
      ...prefixArgs,
      "dev",
      "--no-discovery",
      "--no-poll",
      "--port",
      url.port || "8288",
      "--retry-interval",
      "1",
      "--tick",
      "10",
    ],
    "inngest dev server",
  );
  await waitForHttp(`${args.devUrl}/dev`, 60_000, devServer);
  return devServer;
};

const syncExample = async (example: RunnableExample): Promise<void> => {
  const response = await http(example.sdkUrl, { method: "PUT", timeoutMs: 10_000 }).catch((error) => {
    if (example.localUrl === example.sdkUrl) {
      throw error;
    }
    return http(example.localUrl, {
      headers: { Host: new URL(example.sdkUrl).host },
      method: "PUT",
      timeoutMs: 10_000,
    });
  });
  if (response.status < 200 || response.status >= 300) {
    throw new Error(`${example.file} SDK sync failed with ${response.status}: ${response.body}`);
  }
};

const removeSyncedApp = async (devUrl: string, sdkUrl: string): Promise<void> => {
  try {
    await http(`${devUrl}/fn/remove?url=${encodeURIComponent(sdkUrl)}`, {
      method: "DELETE",
      timeoutMs: 5_000,
    });
  } catch {
    // Best-effort cleanup only; a later PUT sync replaces functions for the same URL.
  }
};

const sendEvents = async (
  devUrl: string,
  eventKey: string,
  events: ReadonlyArray<{ readonly name: string; readonly data: unknown; readonly id?: string }>,
): Promise<ReadonlyArray<string>> => {
  const response = await http(`${devUrl}/e/${eventKey}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(events),
    timeoutMs: 10_000,
  });

  if (response.status < 200 || response.status >= 300) {
    throw new Error(`Sending ${events.map((e) => e.name).join(", ")} failed with ${response.status}: ${response.body}`);
  }

  const body = JSON.parse(response.body) as { readonly ids?: ReadonlyArray<string> };
  if (!Array.isArray(body.ids) || body.ids.length === 0) {
    throw new Error(`Event response did not include ids: ${JSON.stringify(body)}`);
  }
  return body.ids;
};

const getEventRuns = async (
  cli: ReadonlyArray<string>,
  devUrl: string,
  eventId: string,
): Promise<ReadonlyArray<Record<string, unknown>>> => {
  const body = await cliJson(cli, [
    "api",
    "--api-host",
    devUrl,
    "get-event-runs",
    eventId,
    "--include-output",
    "--limit",
    "40",
  ]);
  const data = property(body, "data");
  return Array.isArray(data) ? (data.filter(isRecord) as ReadonlyArray<Record<string, unknown>>) : [];
};

const getFunctionRun = async (
  cli: ReadonlyArray<string>,
  devUrl: string,
  runId: string,
): Promise<Record<string, unknown>> => {
  const body = await cliJson(cli, ["api", "--api-host", devUrl, "get-function-run", runId, "--include-output"]);
  const data = property(body, "data");
  if (!isRecord(data)) {
    throw new Error(`Function run response did not contain data object: ${JSON.stringify(body)}`);
  }
  return data;
};

const getFunctionTrace = async (
  cli: ReadonlyArray<string>,
  devUrl: string,
  runId: string,
): Promise<Record<string, unknown>> => {
  const body = await cliJson(cli, ["api", "--api-host", devUrl, "get-function-trace", runId, "--include-output"]);
  const data = property(body, "data");
  if (!isRecord(data)) {
    throw new Error(`Function trace response did not contain data object: ${JSON.stringify(body)}`);
  }
  return data;
};

const waitForExpectedRuns = async (
  cli: ReadonlyArray<string>,
  devUrl: string,
  eventId: string,
  expectedRuns: ReadonlyArray<ResolvedExpectedRun>,
  timeoutMs: number,
): Promise<
  ReadonlyArray<{ readonly expected: ResolvedExpectedRun; readonly runId: string; readonly status: string }>
> => {
  const deadline = Date.now() + timeoutMs;
  let lastRuns: ReadonlyArray<Record<string, unknown>> = [];

  while (Date.now() < deadline) {
    lastRuns = await getEventRuns(cli, devUrl, eventId);
    const matches = expectedRuns.map((expected) => ({ expected, run: findRun(lastRuns, expected) }));

    const missing = matches.filter(({ run }) => !run);
    if (missing.length === 0) {
      const statuses = matches.map(({ expected, run }) => {
        const status = propertyString(run, "status", "UNKNOWN");
        return { expected, runId: propertyString(run, "id", ""), status };
      });

      const badTerminal = statuses.find(
        ({ expected, status }) => terminalStatuses.has(status) && !allowedStatuses(expected).has(status),
      );
      if (badTerminal) {
        throw new Error(
          `${badTerminal.expected.functionId} ended with ${badTerminal.status}, expected ${[...allowedStatuses(badTerminal.expected)].join("/")}\n${JSON.stringify(lastRuns, null, 2)}`,
        );
      }

      if (statuses.every(({ expected, status, runId }) => runId && allowedStatuses(expected).has(status))) {
        return statuses;
      }
    }

    await sleep(1_000);
  }

  throw new Error(
    `Timed out waiting for ${expectedRuns.map((r) => r.functionId).join(", ")} from event ${eventId}\n${JSON.stringify(lastRuns, null, 2)}`,
  );
};

const waitForFunctionRun = async (
  cli: ReadonlyArray<string>,
  devUrl: string,
  runId: string,
  expected: ResolvedExpectedRun,
  timeoutMs: number,
): Promise<{ readonly runId: string; readonly status: string }> => {
  const deadline = Date.now() + timeoutMs;
  let lastRun: Record<string, unknown> | undefined;

  while (Date.now() < deadline) {
    lastRun = await getFunctionRun(cli, devUrl, runId);
    const status = propertyString(lastRun, "status", "UNKNOWN");
    if (allowedStatuses(expected).has(status)) {
      return { runId, status };
    }
    if (terminalStatuses.has(status)) {
      throw new Error(
        `${expected.functionId} ended with ${status}, expected ${[...allowedStatuses(expected)].join("/")}\n${JSON.stringify(lastRun, null, 2)}`,
      );
    }
    await sleep(1_000);
  }

  throw new Error(`Timed out waiting for invoked run ${runId}\n${JSON.stringify(lastRun, null, 2)}`);
};

const allowedStatuses = (expected: ResolvedExpectedRun): ReadonlySet<string> =>
  new Set(Array.isArray(expected.status) ? expected.status : [expected.status ?? "COMPLETED"]);

const findRun = (
  runs: ReadonlyArray<Record<string, unknown>>,
  expected: ResolvedExpectedRun,
): Record<string, unknown> | undefined =>
  runs.find((candidate) => {
    const app = property(candidate, "app");
    const fn = property(candidate, "function");
    return (
      isRecord(app) &&
      property(app, "id") === expected.appId &&
      isRecord(fn) &&
      property(fn, "id") === expected.functionId
    );
  });

const assertTrace = (trace: Record<string, unknown>, expected: ResolvedExpectedRun): void => {
  const rootSpan = property(trace, "rootSpan");
  if (!isRecord(rootSpan)) {
    throw new Error(`Trace did not include rootSpan: ${JSON.stringify(trace, null, 2)}`);
  }

  const spans = flattenSpans(rootSpan);
  if (spans.length === 0) {
    throw new Error(`Trace rootSpan had no timeline spans: ${JSON.stringify(trace, null, 2)}`);
  }

  const names = spans.map((span) => propertyString(span, "name", ""));
  for (const spanName of expected.spans ?? []) {
    if (!names.includes(spanName)) {
      throw new Error(`Trace for ${expected.functionId} did not include span ${spanName}. Saw: ${names.join(", ")}`);
    }
  }
};

const flattenSpans = (span: Record<string, unknown>): ReadonlyArray<Record<string, unknown>> => {
  const children = property(span, "children");
  if (!Array.isArray(children)) {
    return [span];
  }
  return [span, ...children.filter(isRecord).flatMap((child) => flattenSpans(child))];
};

const invokeFunction = async (
  cli: ReadonlyArray<string>,
  devUrl: string,
  appId: string,
  functionTag: string,
  data: unknown,
): Promise<string> => {
  const body = await cliJson(cli, [
    "api",
    "--api-host",
    devUrl,
    "invoke-function",
    appId,
    functionTag,
    "--data",
    JSON.stringify(data),
  ]);
  const runIds = collectRunIds(body);
  const runId = runIds[0];
  if (!runId) {
    throw new Error(`invoke-function response did not include a run id: ${JSON.stringify(body, null, 2)}`);
  }
  return runId;
};

const collectRunIds = (value: unknown): ReadonlyArray<string> => {
  const ids: Array<string> = [];
  const visit = (current: unknown): void => {
    if (Array.isArray(current)) {
      current.forEach(visit);
      return;
    }
    if (!isRecord(current)) {
      return;
    }
    for (const [key, child] of Object.entries(current)) {
      if (/^run_?id$/i.test(key) && typeof child === "string") {
        ids.push(child);
      }
      visit(child);
    }
  };
  visit(value);
  return ids;
};

const property = (value: unknown, key: string): unknown => (isRecord(value) ? value[key] : undefined);

const propertyString = (value: unknown, key: string, fallback: string): string => {
  const result = property(value, key);
  return typeof result === "string" ? result : fallback;
};

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;

const loadExamples = async (): Promise<ReadonlyArray<LoadedExample>> => {
  const files = readdirSync(examplesDir)
    .filter((file) => /^\d{3}-.+\.ts$/.test(file))
    .sort();

  const loaded: Array<LoadedExample> = [];
  for (const file of files) {
    const moduleUrl = pathToFileURL(join(examplesDir, file)).href;
    const module = (await import(moduleUrl)) as { readonly default?: unknown };
    if (!isExampleDefinition(module.default)) {
      throw new Error(`${file} must default-export an example definition`);
    }
    loaded.push({ file, definition: module.default });
  }
  return loaded;
};

const isExampleDefinition = (value: unknown): value is ExampleDefinition =>
  isRecord(value) &&
  typeof value.id === "string" &&
  Array.isArray(value.cases) &&
  (value.group === undefined || isRecord(value.group)) &&
  (value.handlers === undefined || isRecord(value.handlers));

const selectExamples = (
  examples: ReadonlyArray<LoadedExample>,
  filters: ReadonlyArray<string>,
): ReadonlyArray<LoadedExample> => {
  const selected = examples.filter(
    (example) =>
      filters.length === 0 ||
      filters.some((filter) => example.file.includes(filter) || example.definition.id.includes(filter)),
  );
  if (selected.length === 0) {
    throw new Error("No examples matched the requested filters");
  }
  return selected;
};

const validateExamples = (examples: ReadonlyArray<LoadedExample>): void => {
  const ids = new Map<string, string>();
  for (const example of examples) {
    const previous = ids.get(example.definition.id);
    if (previous) {
      throw new Error(`${example.file} and ${previous} both use example id ${example.definition.id}`);
    }
    ids.set(example.definition.id, example.file);

    const group = example.definition.group;
    if (!group) {
      if (example.definition.cases.some((exampleCase) => exampleCase.kind !== "effect")) {
        throw new Error(`${example.file} has event/invoke cases but no group`);
      }
      continue;
    }

    if (!example.definition.handlers) {
      throw new Error(`${example.file} has a group but no handlers layer`);
    }

    const tags = new Set(group.functions.keys());
    for (const exampleCase of example.definition.cases) {
      if (exampleCase.kind === "effect") {
        continue;
      }
      if (exampleCase.kind === "invoke" && !tags.has(exampleCase.functionTag)) {
        throw new Error(`${example.file} invokes unknown function tag ${exampleCase.functionTag}`);
      }
      const expectedRuns = exampleCase.kind === "event" ? exampleCase.expect : [exampleCase.expect];
      for (const expected of expectedRuns) {
        if (!tags.has(expected.functionTag)) {
          throw new Error(`${example.file} expects unknown function tag ${expected.functionTag}`);
        }
      }
    }
  }
};

const toRunnableExamples = (examples: ReadonlyArray<LoadedExample>, args: Args): ReadonlyArray<RunnableExample> =>
  examples.map((example) => {
    const appId = `examples-${example.definition.id}`;
    const localUrl = exampleUrl(args.localSdkUrl, example.definition.id);
    const sdkUrl = exampleUrl(args.sdkUrl, example.definition.id);

    if (!example.definition.group || !example.definition.handlers) {
      return { ...example, appId, localUrl, sdkUrl };
    }

    const ClientLive = InngestClient.layer({
      id: appId,
      mode: "dev",
      apiBaseUrl: `${args.devUrl}/`,
      eventBaseUrl: `${args.devUrl}/`,
      eventKey: defaultEventKey,
    }).pipe(Layer.provide(FetchHttpClient.layer));
    const layer = Layer.mergeAll(example.definition.handlers, ClientLive, FetchHttpClient.layer);
    const { handler, dispose } = InngestGroup.toWebHandler(example.definition.group, { layer });
    return { ...example, appId, localUrl, sdkUrl, handler, dispose };
  });

const exampleUrl = (baseUrl: string, id: string): string => new URL(`examples/${id}`, baseUrl).toString();

const startSdkServer = (
  args: Args,
  examples: ReadonlyArray<RunnableExample>,
): { readonly stop: () => Promise<void> } => {
  const routes = new Map<string, RunnableExample>();
  for (const example of examples) {
    if (!example.handler) {
      continue;
    }
    routes.set(normalizePath(new URL(example.localUrl).pathname), example);
  }

  const url = new URL(args.localSdkUrl);
  const server = Bun.serve({
    hostname: url.hostname,
    port: Number(url.port || "9999"),
    fetch: (request) => {
      const path = normalizePath(new URL(request.url).pathname);
      const example = routes.get(path);
      if (!example?.handler) {
        return new Response(`Unknown example route: ${path}`, { status: 404 });
      }
      return example.handler(request);
    },
  });

  return {
    stop: async () => {
      await Promise.all(examples.map((example) => example.dispose?.()));
      server.stop(true);
    },
  };
};

const normalizePath = (path: string): string => {
  const normalized = path.replace(/\/+$/, "");
  return normalized === "" ? "/" : normalized;
};

const resolveExpected = (example: RunnableExample, expected: ExpectedRun): ResolvedExpectedRun => {
  const { functionTag, ...rest } = expected;
  return { ...rest, appId: example.appId, functionId: registeredFunctionId(example, functionTag) };
};

const registeredFunctionId = (_example: RunnableExample, functionTag: string): string => functionTag;

const runCase = async (
  cli: ReadonlyArray<string>,
  args: Args,
  example: RunnableExample,
  exampleCase: ExampleCase,
): Promise<void> => {
  if (exampleCase.kind === "effect") {
    const ClientLive = InngestClient.layer({
      id: example.appId,
      mode: "dev",
      apiBaseUrl: `${args.devUrl}/`,
      eventBaseUrl: `${args.devUrl}/`,
      eventKey: defaultEventKey,
    }).pipe(Layer.provide(FetchHttpClient.layer));
    await withTimeout(
      Effect.runPromise(exampleCase.effect.pipe(Effect.provide(ClientLive))),
      exampleCase.timeoutMs ?? 30_000,
      example.file,
    );
    return;
  }

  if (exampleCase.kind === "invoke") {
    const expected = resolveExpected(example, exampleCase.expect);
    const runId = await invokeFunction(cli, args.devUrl, example.appId, exampleCase.functionTag, exampleCase.data);
    const status = await waitForFunctionRun(
      cli,
      args.devUrl,
      runId,
      expected,
      exampleCase.timeoutMs ?? expected.timeoutMs ?? 30_000,
    );
    const trace = await getFunctionTrace(cli, args.devUrl, status.runId);
    assertTrace(trace, expected);
    return;
  }

  const eventIds = await sendEvents(args.devUrl, exampleCase.eventKey ?? "local", exampleCase.events);

  for (const afterEvent of exampleCase.afterEvents ?? []) {
    setTimeout(() => {
      void sendEvents(args.devUrl, afterEvent.eventKey ?? exampleCase.eventKey ?? "local", afterEvent.events).catch(
        (error) => {
          console.error(`Failed to send follow-up event for ${example.file}: ${String(error)}`);
        },
      );
    }, afterEvent.delayMs);
  }

  const expectedRuns = exampleCase.expect.map((expected) => resolveExpected(example, expected));
  const statuses = await waitForExpectedRuns(
    cli,
    args.devUrl,
    eventIds[0]!,
    expectedRuns,
    exampleCase.timeoutMs ?? 30_000,
  );
  for (const status of statuses) {
    const trace = await getFunctionTrace(cli, args.devUrl, status.runId);
    assertTrace(trace, status.expected);
  }
};

const main = async (): Promise<void> => {
  const args = parseArgs();
  const loaded = await loadExamples();
  const selected = selectExamples(loaded, args.filters);
  validateExamples(selected);

  if (args.list) {
    for (const example of selected) {
      console.log(example.file);
    }
    return;
  }

  const cli = await cliPrefix();
  const runnable = toRunnableExamples(selected, args);
  const serverExamples = runnable.filter((example) => example.handler);
  let devServer: ManagedProcess | undefined;
  let sdkServer: { readonly stop: () => Promise<void> } | undefined;

  try {
    devServer = await startDevServer(args, cli);
    sdkServer = startSdkServer(args, runnable);

    await Promise.all(serverExamples.map((example) => syncExample(example)));
    console.log(
      `Running ${runnable.reduce((sum, example) => sum + example.definition.cases.length, 0)} case(s) from ${runnable.length} example(s) against ${args.devUrl}`,
    );

    const tasks = runnable.flatMap((example) =>
      example.definition.cases.map((exampleCase, index) => ({
        label: `${example.file}#${index + 1}`,
        run: () => runCase(cli, args, example, exampleCase),
      })),
    );

    const results = await Promise.allSettled(
      tasks.map(async (task) => {
        await task.run();
        return task.label;
      }),
    );

    const failures = results.flatMap((result, index) =>
      result.status === "rejected" ? [`${tasks[index]!.label}: ${String(result.reason)}`] : [],
    );
    for (const result of results) {
      if (result.status === "fulfilled") {
        console.log(`✓ ${result.value}`);
      }
    }
    if (failures.length > 0) {
      throw new Error(`Failed ${failures.length}/${tasks.length} example case(s):\n${failures.join("\n\n")}`);
    }
  } finally {
    await Promise.all(
      serverExamples.flatMap((example) => [
        removeSyncedApp(args.devUrl, example.sdkUrl),
        example.sdkUrl === example.localUrl ? Promise.resolve() : removeSyncedApp(args.devUrl, example.localUrl),
      ]),
    );
    await sdkServer?.stop();
    await stopManaged(devServer);
  }
};

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
