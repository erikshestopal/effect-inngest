import { spawn } from "node:child_process";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { getLocal } from "mockttp";

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

const omittedHeaders = new Set([
  "accept",
  "accept-encoding",
  "accept-language",
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
          : value;

        return [lowerKey, valueToRecord];
      })
      .sort(([a], [b]) => a.localeCompare(b)),
  );

const serializeBody = async (body) => parseBody((await body.getText()) ?? body.buffer?.toString("utf8") ?? "");

const resetRecording = () => {
  sequence = 0;
  exchanges = [];
};

const recordProxy = async ({ direction, name, port, proxyOrigin, targetOrigin }) => {
  const server = getLocal({ recordTraffic: true, suggestChanges: false });
  const requests = new Map();

  await server.start(port);
  await server.on("request", (request) => {
    const url = new URL(request.url, proxyOrigin);
    const record = {
      sequence: ++sequence,
      method: request.method,
      url: url.toString(),
      path: url.pathname,
      query: Object.fromEntries(url.searchParams.entries()),
      headers: sanitizeHeaders(request.headers),
    };

    requests.set(request.id, serializeBody(request.body).then((body) => ({ ...record, body })));
  });
  await server.on("response", async (response) => {
    const requestPromise = requests.get(response.id);
    if (!requestPromise) return;

    const request = await requestPromise;
    exchanges.push({
      sequence: request.sequence,
      direction,
      proxy: name,
      request: {
        method: request.method,
        url: request.url,
        path: request.path,
        query: request.query,
        headers: request.headers,
        body: request.body,
      },
      response: {
        status: response.statusCode,
        headers: sanitizeHeaders(response.headers),
        body: await serializeBody(response.body),
      },
    });
  });
  await server.forAnyRequest().thenForwardTo(targetOrigin);

  console.log(`${name} recorder listening on ${proxyOrigin} -> ${targetOrigin}`);
  return server;
};

const http = async (url, { body, headers, method = "GET", timeoutMs = 10_000 } = {}) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, { body, headers, method, signal: controller.signal });
    return { body: await response.text(), status: response.status };
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

const waitForExecutionRecordings = async (server, path, expectedCount) => {
  const deadline = Date.now() + 30_000;

  while (Date.now() < deadline) {
    if (server.child.exitCode !== null) {
      throw new Error(`${server.label} exited early\n${server.getOutput()}`);
    }

    const actualCount = exchanges.filter(
      (exchange) => exchange.direction === "inbound" && exchange.request.method === "POST" && exchange.request.path === path,
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

const writeFixture = async (exampleId, runtimeName) => {
  const ordered = [...exchanges].sort((a, b) => a.sequence - b.sequence);
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
    await writeFixture(example.id, runtimeName);
    console.log(`recorded ${exchanges.length} ${runtimeName} HTTP exchanges to ${fixtureFile(example.id, runtimeName)}`);
  } finally {
    await removeSyncedApp(sdkUrl);
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
