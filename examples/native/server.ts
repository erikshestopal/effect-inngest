/// <reference types="bun" />

import { readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Inngest } from "inngest";
import { serve } from "inngest/bun";
import type { NativeExample, NativeExampleFactory } from "./_support.ts";

interface ServedNativeExample extends NativeExample {
  readonly client: Inngest.Any;
}

const nativeDir = dirname(fileURLToPath(import.meta.url));

const port = Number(process.env.NATIVE_INNGEST_PORT ?? "9999");
const servePath = process.env.NATIVE_INNGEST_SERVE_PATH ?? "/api/inngest";
const serveOrigin = process.env.NATIVE_INNGEST_SERVE_ORIGIN ?? `http://127.0.0.1:${port}`;
const baseUrl = process.env.NATIVE_INNGEST_BASE_URL ?? "http://127.0.0.1:8288";
const appId = process.env.NATIVE_INNGEST_APP_ID;
const selectedExampleIds = new Set(
  (process.env.NATIVE_INNGEST_EXAMPLE_IDS ?? "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean),
);

const exampleFiles = readdirSync(nativeDir)
  .filter((file) => /^\d+-.*\.ts$/.test(file))
  .sort();

const examples: Array<ServedNativeExample> = [];

for (const file of exampleFiles) {
  const module = await import(pathToFileURL(join(nativeDir, file)).href);
  const factory = module.default as NativeExampleFactory | undefined;

  if (typeof factory !== "function") {
    throw new Error(`Native example ${file} must default-export defineNativeExample(...)`);
  }

  const exampleId = file.replace(/\.ts$/, "");
  const inngest = new Inngest({ id: appId ?? `examples-${exampleId}`, isDev: true, baseUrl });
  const example = factory(inngest);

  if (selectedExampleIds.size === 0 || selectedExampleIds.has(example.id)) {
    examples.push({ ...example, client: inngest });
  }
}

const missingExampleIds = [...selectedExampleIds].filter((id) => !examples.some((example) => example.id === id));
if (missingExampleIds.length > 0) {
  throw new Error(`Unknown native example ids: ${missingExampleIds.join(", ")}`);
}

const functions = examples.flatMap((example) => example.functions);
const manifest = examples.map((example) => ({ id: example.id, cases: example.cases }));
const handlers = examples.map((example) => ({
  id: example.id,
  handler: serve({
    client: example.client,
    functions: example.functions,
    serveOrigin,
    servePath,
  }),
}));

Bun.serve({
  hostname: "127.0.0.1",
  port,
  fetch(request: Request) {
    const url = new URL(request.url);

    const handler = handlers.find((entry) => url.pathname === `/examples/${entry.id}`);
    if (handler) {
      return handler.handler(request);
    }

    if (url.pathname === "/health") {
      return Response.json({ examples: examples.length, functions: functions.length, ok: true });
    }

    if (url.pathname === "/__native/examples") {
      return Response.json({ appId: appId ?? "examples", examples: manifest });
    }

    return new Response("Not found", { status: 404 });
  },
});

console.log(
  `native inngest-js harness listening on http://127.0.0.1:${port}${servePath} with ${functions.length} functions`,
);
