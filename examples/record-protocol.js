import { spawn } from "node:child_process";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const examplesDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(examplesDir, "..");
const fixturesRoot = join(examplesDir, "fixtures");

const realDevOrigin = "http://127.0.0.1:8288";
const recordedDevOrigin = "http://127.0.0.1:18289";
const recordedSdkOrigin = "http://127.0.0.1:19998";
const realSdkOrigin = "http://127.0.0.1:19999";

const runtimes = {
  effect: {
    label: "effect-inngest",
    manifestPath: "/__effect/examples",
    serverFile: join(examplesDir, "effect-server.ts"),
    env: (example) => ({
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
    env: (example) => ({
      NATIVE_INNGEST_APP_ID: example ? appIdFor(example.id) : "examples",
      NATIVE_INNGEST_BASE_URL: recordedDevOrigin,
      NATIVE_INNGEST_EXAMPLE_IDS: example?.id ?? "",
      NATIVE_INNGEST_PORT: "19999",
      NATIVE_INNGEST_SERVE_ORIGIN: recordedSdkOrigin,
      NATIVE_INNGEST_SERVE_PATH: example ? examplePath(example.id) : "/api/inngest",
    }),
  },
};

let sequence = 0;
let exchanges = [];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const parseArgs = () => {
  const filters = [];
  let runtime = "both";

  for (let index = 2; index < process.argv.length; index++) {
    const arg = process.argv[index];

    if (arg === "--runtime") {
      runtime = process.argv[++index] ?? runtime;
    } else if (arg === "--only" || arg === "--filter") {
      const filter = process.argv[++index];
      if (!filter) throw new Error(`${arg} requires a value`);
      filters.push(filter);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!["both", "effect", "native"].includes(runtime)) {
    throw new Error(`--runtime must be native, effect, or both; received ${runtime}`);
  }

  return { filters, runtime };
};

const selectedRuntimes = (runtime) => (runtime === "both" ? ["native", "effect"] : [runtime]);

const matchesFilters = (example, filters) =>
  filters.length === 0 || filters.some((filter) => example.id.includes(filter) || example.path?.includes(filter));

const examplePath = (exampleId) => `/examples/${exampleId}`;

const sdkUrlFor = (exampleId) => `${recordedSdkOrigin}${examplePath(exampleId)}`;

const appIdFor = (exampleId) => `examples-${exampleId}`;

const parseBody = (text) => {
  if (!text) return null;

  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
};

const sanitizeEventBody = (event) => {
  if (!event || typeof event !== "object" || Array.isArray(event)) return event;

  return {
    ...event,
    ...(event.id !== undefined ? { id: "<event-id>" } : {}),
    ...(event.ts !== undefined ? { ts: "<event-ts>" } : {}),
  };
};

const orderObject = (value, keys) => {
  const ordered = {};
  for (const key of keys) {
    if (Object.hasOwn(value, key)) ordered[key] = canonicalizeProtocolValue(value[key]);
  }
  for (const [key, child] of Object.entries(value)) {
    if (!Object.hasOwn(ordered, key)) ordered[key] = canonicalizeProtocolValue(child);
  }
  return ordered;
};

const opcodeKeyOrder = (value) => {
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

const canonicalizeProtocolValue = (value) => {
  if (Array.isArray(value)) return value.map(canonicalizeProtocolValue);
  if (!value || typeof value !== "object") return value;

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
  if (Object.hasOwn(value, "a") && Object.hasOwn(value, "b")) return orderObject(value, ["a", "b"]);
  if (Object.hasOwn(value, "id") && Object.hasOwn(value, "name") && Object.keys(value).length === 2) {
    return orderObject(value, ["id", "name"]);
  }

  return orderObject(value, []);
};

const sanitizeProtocolBody = (body) => {
  if (Array.isArray(body)) return canonicalizeProtocolValue(body);
  if (!body || typeof body !== "object") return body;

  const sanitized = { ...body };

  if (sanitized.sync_id !== undefined) sanitized.sync_id = "<sync-id>";
  if (sanitized.sdk !== undefined) sanitized.sdk = "<sdk>";

  if (sanitized.ctx && typeof sanitized.ctx === "object" && !Array.isArray(sanitized.ctx)) {
    sanitized.ctx = { ...sanitized.ctx };
    for (const key of ["job_id", "qi_id", "request_id", "run_id"]) {
      if (sanitized.ctx[key] !== undefined) sanitized.ctx[key] = `<${key}>`;
    }
  }

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

const sanitizeHeaders = (headers) =>
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
      .sort(([a], [b]) => a.localeCompare(b)),
  );

const resetRecording = () => {
  sequence = 0;
  exchanges = [];
};

const requestBody = async (request) => {
  if (["GET", "HEAD"].includes(request.method)) return "";
  return await request.clone().text();
};

const recordProxy = async ({ direction, name, port, proxyOrigin, targetOrigin }) => {
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port,
    async fetch(request) {
      const url = new URL(request.url);
      const targetUrl = `${targetOrigin}${url.pathname}${url.search}`;
      const bodyText = await requestBody(request);
      const headers = new Headers(request.headers);
      headers.delete("content-length");
      headers.set("host", new URL(targetOrigin).host);

      const requestRecord = {
        sequence: ++sequence,
        method: request.method,
        url: `${proxyOrigin}${url.pathname}${url.search}`,
        path: url.pathname,
        query: Object.fromEntries(url.searchParams.entries()),
        headers: sanitizeHeaders(Object.fromEntries(request.headers.entries())),
        body: sanitizeProtocolBody(parseBody(bodyText)),
      };

      let upstream;
      try {
        upstream = await fetch(targetUrl, {
          body: bodyText ? bodyText : undefined,
          headers,
          method: request.method,
          redirect: "manual",
        });
      } catch (error) {
        if (error instanceof Error && "code" in error && error.code === "ConnectionRefused") {
          return new Response("SDK server stopped", { status: 410 });
        }

        throw error;
      }
      const responseText = await upstream.text();

      exchanges.push({
        sequence: requestRecord.sequence,
        direction,
        proxy: name,
        request: requestRecord,
        response: {
          status: upstream.status,
          headers: sanitizeHeaders(Object.fromEntries(upstream.headers.entries())),
          body: sanitizeProtocolBody(parseBody(responseText)),
        },
      });

      return new Response(responseText, { headers: upstream.headers, status: upstream.status });
    },
  });

  console.log(`${name} recorder listening on ${proxyOrigin} -> ${targetOrigin}`);
  return { stop: () => server.stop(true) };
};

const http = async (url, { body, headers, method = "GET", timeoutMs = 10_000 } = {}) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const fetchOptions = { headers, method, signal: controller.signal };
  if (body !== undefined && !["GET", "HEAD"].includes(method)) fetchOptions.body = body;

  try {
    const response = await fetch(url, fetchOptions);
    return { body: await response.text(), status: response.status };
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new Error(`${method} ${url} timed out after ${timeoutMs}ms`);
    }

    throw error;
  } finally {
    clearTimeout(timeout);
  }
};

const json = async (url, options) => {
  const response = await http(url, options);
  if (response.status < 200 || response.status >= 300) {
    throw new Error(`${url} returned ${response.status}: ${response.body}`);
  }

  return JSON.parse(response.body);
};

const waitForHttp = async (url, timeoutMs, processHandle) => {
  const deadline = Date.now() + timeoutMs;
  let lastError;

  while (Date.now() < deadline) {
    if (processHandle?.child.exitCode !== null) {
      throw new Error(`${processHandle.label} exited early\n${processHandle.getOutput()}`);
    }

    try {
      const response = await http(url, { timeoutMs: 1_000 });
      if (response.status >= 200 && response.status < 300) return;
      lastError = new Error(`${url} returned ${response.status}`);
    } catch (error) {
      lastError = error;
    }

    await sleep(250);
  }

  throw new Error(`Timed out waiting for ${url}: ${String(lastError)}`);
};

const commandExists = (command) =>
  new Promise((resolve) => {
    const child = spawn("sh", ["-c", `command -v ${command} >/dev/null 2>&1`], { stdio: "ignore" });
    child.on("exit", (code) => resolve(code === 0));
    child.on("error", () => resolve(false));
  });

const cliPrefix = async () => {
  if (process.env.INNGEST_CLI) return process.env.INNGEST_CLI.split(" ").filter(Boolean);
  if (await commandExists("inngest")) return ["inngest"];
  return ["npx", "--yes", "--ignore-scripts=false", "inngest-cli@latest"];
};

const spawnManaged = (command, args, label, env = {}) => {
  let output = "";
  const child = spawn(command, args, {
    cwd: repoRoot,
    detached: true,
    env: { ...process.env, ...env, NO_COLOR: "1", NO_UPDATE_NOTIFIER: "1", NPM_CONFIG_UPDATE_NOTIFIER: "false" },
    stdio: ["ignore", "pipe", "pipe"],
  });

  const append = (chunk) => {
    output = `${output}${chunk.toString()}`.slice(-20_000);
  };
  child.stdout.on("data", append);
  child.stderr.on("data", append);

  return { child, label, getOutput: () => output };
};

const waitForExit = (child, timeoutMs) =>
  new Promise((resolve) => {
    if (child.exitCode !== null) {
      resolve();
      return;
    }

    const timeout = setTimeout(resolve, timeoutMs);
    child.once("exit", () => {
      clearTimeout(timeout);
      resolve();
    });
  });

const stopManaged = async (processHandle) => {
  if (!processHandle || processHandle.child.exitCode !== null) return;

  const pid = processHandle.child.pid;
  if (!pid) return;

  try {
    globalThis.process.kill(-pid, "SIGTERM");
  } catch {
    processHandle.child.kill("SIGTERM");
  }

  await waitForExit(processHandle.child, 2_000);

  if (processHandle.child.exitCode === null) {
    try {
      globalThis.process.kill(-pid, "SIGKILL");
    } catch {
      processHandle.child.kill("SIGKILL");
    }

    await waitForExit(processHandle.child, 2_000);
  }
};

const startDevServer = async () => {
  try {
    const response = await http(`${realDevOrigin}/dev`, { timeoutMs: 1_000 });
    if (response.status >= 200 && response.status < 300) {
      console.log(`using existing Inngest dev server at ${realDevOrigin}`);
      return undefined;
    }
  } catch {
    // Start a dev server below.
  }

  const [command, ...prefixArgs] = await cliPrefix();
  if (!command) throw new Error("Empty Inngest CLI command");

  const devServer = spawnManaged(
    command,
    [...prefixArgs, "dev", "--no-discovery", "--no-poll", "--port", "8288", "--retry-interval", "1", "--tick", "10"],
    "inngest dev server",
  );

  await waitForHttp(`${realDevOrigin}/dev`, 60_000, devServer);
  return devServer;
};

const startRuntimeServer = async (runtimeName, example) => {
  const runtime = runtimes[runtimeName];
  const server = spawnManaged("bun", [runtime.serverFile], `${runtime.label} harness`, runtime.env(example));

  await waitForHttp(`${realSdkOrigin}/health`, 20_000, server);
  return server;
};

const assertOk = (label, response) => {
  if (response.status < 200 || response.status >= 300) {
    throw new Error(`${label} failed with ${response.status}: ${response.body}`);
  }
};

const withFixtureIds = (exampleId, caseId, events) =>
  events.map((event, eventIndex) => ({
    ...event,
    id: event.id ?? `fixture-${exampleId}-${caseId}-${eventIndex}`,
  }));

const sendEvents = async (eventKey, events) =>
  assertOk(
    `send ${events.map((event) => event.name).join(", ")}`,
    await http(`${realDevOrigin}/e/${eventKey}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(events),
    }),
  );

const triggerCase = async (runtimeName, example, caseData, caseIndex) => {
  if (caseData.kind !== "event") {
    throw new Error(`Unsupported protocol fixture case kind: ${caseData.kind}`);
  }

  const fixturePrefix = `${runtimeName}-${example.id}`;
  await sendEvents(caseData.eventKey ?? "local", withFixtureIds(fixturePrefix, caseIndex, caseData.events));

  for (const [afterIndex, afterEvent] of (caseData.afterEvents ?? []).entries()) {
    setTimeout(() => {
      void sendEvents(
        afterEvent.eventKey ?? caseData.eventKey ?? "local",
        withFixtureIds(fixturePrefix, `${caseIndex}-after-${afterIndex}`, afterEvent.events),
      ).catch((error) => {
        console.error(`Failed follow-up events for ${example.id}:`, error);
      });
    }, afterEvent.delayMs);
  }
};

const expectedExecutionCount = (example) =>
  example.cases.reduce((total, caseData) => total + (caseData.expect?.length ?? 1), 0);

const drainDelayMs = (example) => {
  const afterEventDelay = Math.max(
    0,
    ...example.cases.flatMap((caseData) => (caseData.afterEvents ?? []).map((afterEvent) => afterEvent.delayMs)),
  );

  return Math.min(10_000, Math.max(1_500, afterEventDelay + 1_500));
};

const waitForExecutionRecordings = async (server, path, expectedCount) => {
  const deadline = Date.now() + 30_000;

  while (Date.now() < deadline) {
    if (server.child.exitCode !== null) {
      throw new Error(`${server.label} exited early\n${server.getOutput()}`);
    }

    const actualCount = exchanges.filter(
      (exchange) =>
        exchange.direction === "inbound" && exchange.request.method === "POST" && exchange.request.path === path,
    ).length;

    if (actualCount >= expectedCount) return;
    await sleep(250);
  }

  const observed = exchanges.map((exchange) => ({
    body: exchange.request.path === "/fn/register" ? exchange.request.body : undefined,
    direction: exchange.direction,
    method: exchange.request.method,
    path: exchange.request.path,
    status: exchange.response.status,
  }));
  throw new Error(
    `Timed out waiting for ${expectedCount} execution recordings at ${path}\nObserved exchanges: ${JSON.stringify(observed, null, 2)}`,
  );
};

const removeSyncedApp = async (sdkUrl) => {
  try {
    await http(`${realDevOrigin}/fn/remove?url=${encodeURIComponent(sdkUrl)}`, {
      method: "DELETE",
      timeoutMs: 5_000,
    });
  } catch {
    // Best-effort cleanup only.
  }
};

const fixtureFile = (exampleId, runtimeName) => join(fixturesRoot, exampleId, `${runtimeName}.json`);

const stepCompletionOrder = (exchange) => exchange?.request?.body?.ctx?.stack?.stack ?? [];

const isRootParallelPlan = (exchange) =>
  exchange?.direction === "inbound" &&
  exchange?.request?.method === "POST" &&
  exchange?.request?.query?.stepId === "step" &&
  Array.isArray(exchange?.response?.body) &&
  exchange.response.body.length > 1 &&
  exchange.response.body.every((op) => op?.op === "StepPlanned" && typeof op.id === "string");

const isParallelChildRequest = (exchange, orderByPath) =>
  exchange?.direction === "inbound" &&
  exchange?.request?.method === "POST" &&
  typeof exchange?.request?.path === "string" &&
  typeof exchange?.request?.query?.stepId === "string" &&
  exchange.request.query.stepId !== "step" &&
  orderByPath.has(exchange.request.path) &&
  stepCompletionOrder(exchange).length === 0;

const canonicalizeParallelChildOrder = (ordered) => {
  const orderByPath = new Map();

  for (const exchange of ordered) {
    if (isRootParallelPlan(exchange)) {
      orderByPath.set(
        exchange.request.path,
        new Map(exchange.response.body.map((op, index, ops) => [op.id, ops.length - index])),
      );
    }
  }

  if (orderByPath.size === 0) return ordered;

  const normalizeExchange = (exchange) => {
    const order = orderByPath.get(exchange?.request?.path);
    const stack = stepCompletionOrder(exchange);
    if (!order || stack.length <= 1 || !stack.every((id) => order.has(id))) return exchange;

    return {
      ...exchange,
      request: {
        ...exchange.request,
        body: {
          ...exchange.request.body,
          ctx: {
            ...exchange.request.body.ctx,
            stack: {
              ...exchange.request.body.ctx.stack,
              stack: [...stack].sort((a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0)),
            },
          },
        },
      },
    };
  };

  const canonical = [];
  for (let index = 0; index < ordered.length; ) {
    const exchange = normalizeExchange(ordered[index]);
    if (!isParallelChildRequest(exchange, orderByPath)) {
      canonical.push(exchange);
      index++;
      continue;
    }

    const path = exchange.request.path;
    const group = [];
    while (
      index < ordered.length &&
      ordered[index].request?.path === path &&
      isParallelChildRequest(ordered[index], orderByPath)
    ) {
      group.push(normalizeExchange(ordered[index]));
      index++;
    }

    const order = orderByPath.get(path);
    canonical.push(
      ...group.sort((a, b) => (order.get(a.request.query.stepId) ?? 0) - (order.get(b.request.query.stepId) ?? 0)),
    );
  }

  return canonical.map((exchange, index) => ({
    ...exchange,
    sequence: index + 1,
    request: { ...exchange.request, sequence: index + 1 },
  }));
};

const writeFixture = async (exampleId, runtimeName) => {
  const ordered = canonicalizeParallelChildOrder([...exchanges].sort((a, b) => a.sequence - b.sequence));
  const outputFile = fixtureFile(exampleId, runtimeName);
  await mkdir(dirname(outputFile), { recursive: true });
  await writeFile(outputFile, `${JSON.stringify(ordered, null, 2)}\n`);
};

const readExamples = async (runtimeName, filters) => {
  const runtime = runtimes[runtimeName];
  const server = await startRuntimeServer(runtimeName);

  try {
    const manifest = await json(`${realSdkOrigin}${runtime.manifestPath}`);
    const examples = manifest.examples ?? [];
    return examples.filter((example) => matchesFilters(example, filters));
  } finally {
    await stopManaged(server);
  }
};

const recordExample = async (runtimeName, example) => {
  resetRecording();

  const sdkUrl = sdkUrlFor(example.id);
  await removeSyncedApp(sdkUrl);

  const server = await startRuntimeServer(runtimeName, example);

  try {
    assertOk("introspection", await http(sdkUrl, { method: "GET" }));
    assertOk("sync", await http(sdkUrl, { method: "PUT" }));
    await sleep(500);

    for (const [caseIndex, caseData] of example.cases.entries()) {
      await triggerCase(runtimeName, example, caseData, caseIndex);
    }

    await waitForExecutionRecordings(server, examplePath(example.id), expectedExecutionCount(example));
    await sleep(drainDelayMs(example));
    await removeSyncedApp(sdkUrl);
    await writeFixture(example.id, runtimeName);
    console.log(
      `recorded ${exchanges.length} ${runtimeName} HTTP exchanges to ${fixtureFile(example.id, runtimeName)}`,
    );
  } finally {
    await removeSyncedApp(sdkUrl);
    await sleep(250);
    await stopManaged(server);
  }
};

await rm(join(examplesDir, "native", "fixtures"), { force: true, recursive: true });
await mkdir(fixturesRoot, { recursive: true });

const args = parseArgs();
let devServer;
let inboundProxy;
let outboundProxy;

try {
  devServer = await startDevServer();
  inboundProxy = await recordProxy({
    direction: "inbound",
    name: "inngest-to-sdk",
    port: 19998,
    proxyOrigin: recordedSdkOrigin,
    targetOrigin: realSdkOrigin,
  });
  outboundProxy = await recordProxy({
    direction: "outbound",
    name: "sdk-to-inngest",
    port: 18289,
    proxyOrigin: recordedDevOrigin,
    targetOrigin: realDevOrigin,
  });

  for (const runtimeName of selectedRuntimes(args.runtime)) {
    const examples = await readExamples(runtimeName, args.filters);
    if (examples.length === 0) {
      console.log(`no ${runtimeName} examples matched`);
      continue;
    }

    for (const example of examples) {
      await recordExample(runtimeName, example);
    }
  }
} finally {
  await inboundProxy?.stop();
  await outboundProxy?.stop();
  await stopManaged(devServer);
}
