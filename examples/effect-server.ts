/// <reference types="bun" />

import { readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { FetchHttpClient } from "effect/unstable/http";
import * as Layer from "effect/Layer";
import { InngestClient, InngestGroup } from "effect-inngest";
import type { EventExampleCase, ExampleDefinition } from "./_support.ts";

const examplesDir = dirname(fileURLToPath(import.meta.url));

const port = Number(process.env.EFFECT_INNGEST_PORT ?? "9999");
const devUrl = (process.env.EFFECT_INNGEST_DEV_URL ?? "http://127.0.0.1:8288").replace(/\/+$/, "");
const serveOrigin = (process.env.EFFECT_INNGEST_SERVE_ORIGIN ?? `http://127.0.0.1:${port}`).replace(/\/+$/, "");
const selectedExampleIds = new Set(
  (process.env.EFFECT_INNGEST_EXAMPLE_IDS ?? "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean),
);

interface LoadedExample {
  readonly file: string;
  readonly definition: ExampleDefinition;
}

interface RunnableExample {
  readonly appId: string;
  readonly cases: ReadonlyArray<EventExampleCase>;
  readonly dispose: () => Promise<void>;
  readonly handler: (request: Request) => Promise<Response>;
  readonly id: string;
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;

const isExampleDefinition = (value: unknown): value is ExampleDefinition =>
  isRecord(value) &&
  typeof value.id === "string" &&
  Array.isArray(value.cases) &&
  (value.group === undefined || isRecord(value.group)) &&
  (value.handlers === undefined || isRecord(value.handlers));

const examplePath = (id: string): string => `/examples/${id}`;

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

const toRunnableExample = (example: LoadedExample): RunnableExample | undefined => {
  const eventCases = example.definition.cases.filter((exampleCase) => exampleCase.kind === "event");

  if (!example.definition.group || !example.definition.handlers || eventCases.length === 0) {
    return undefined;
  }

  const appId = `examples-${example.definition.id}`;
  const ClientLive = InngestClient.layer({
    id: appId,
    mode: "dev",
    apiBaseUrl: `${devUrl}/`,
    eventBaseUrl: `${devUrl}/`,
    eventKey: "test",
  }).pipe(Layer.provide(FetchHttpClient.layer));
  const layer = Layer.mergeAll(example.definition.handlers, ClientLive, FetchHttpClient.layer);
  const { handler, dispose } = InngestGroup.toWebHandler(example.definition.group, { layer });

  return { appId, cases: eventCases, dispose, handler, id: example.definition.id };
};

const loadedExamples = await loadExamples();
const runnableExamples = loadedExamples
  .filter((example) => selectedExampleIds.size === 0 || selectedExampleIds.has(example.definition.id))
  .flatMap((example) => {
    const runnable = toRunnableExample(example);
    return runnable ? [runnable] : [];
  });

const missingExampleIds = [...selectedExampleIds].filter(
  (id) => !loadedExamples.some((example) => example.definition.id === id),
);
if (missingExampleIds.length > 0) {
  throw new Error(`Unknown Effect example ids: ${missingExampleIds.join(", ")}`);
}

const routes = new Map(runnableExamples.map((example) => [examplePath(example.id), example]));
const manifest = runnableExamples.map((example) => ({
  appId: example.appId,
  cases: example.cases,
  id: example.id,
  path: examplePath(example.id),
}));
const serveOriginUrl = new URL(serveOrigin);

const toPublicRequest = (request: Request, url: URL): Request => {
  const headers = new Headers(request.headers);
  headers.set("host", serveOriginUrl.host);

  return new Request(`${serveOrigin}${url.pathname}${url.search}`, {
    body: request.body,
    headers,
    method: request.method,
    signal: request.signal,
  });
};

const server = Bun.serve({
  hostname: "127.0.0.1",
  port,
  fetch(request: Request) {
    const url = new URL(request.url);

    if (url.pathname === "/health") {
      return Response.json({ examples: runnableExamples.length, ok: true });
    }

    if (url.pathname === "/__effect/examples") {
      return Response.json({ examples: manifest });
    }

    const example = routes.get(url.pathname);
    if (example) {
      return example.handler(toPublicRequest(request, url));
    }

    return new Response("Not found", { status: 404 });
  },
});

const disposeAll = async () => {
  await Promise.all(runnableExamples.map((example) => example.dispose()));
  server.stop(true);
};

process.on("SIGTERM", () => {
  void disposeAll().finally(() => process.exit(0));
});

process.on("SIGINT", () => {
  void disposeAll().finally(() => process.exit(0));
});

console.log(`effect-inngest harness listening on http://127.0.0.1:${port} with ${runnableExamples.length} examples`);
