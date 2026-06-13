/// <reference types="bun" />

import { readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Inngest } from "inngest";
import { serve } from "inngest/bun";
import type { NativeExample, NativeExampleFactory } from "./_support.ts";

const nativeDir = dirname(fileURLToPath(import.meta.url));

const port = Number(process.env.NATIVE_INNGEST_PORT ?? "9999");
const servePath = process.env.NATIVE_INNGEST_SERVE_PATH ?? "/api/inngest";
const serveOrigin = process.env.NATIVE_INNGEST_SERVE_ORIGIN ?? `http://127.0.0.1:${port}`;
const baseUrl = process.env.NATIVE_INNGEST_BASE_URL ?? "http://127.0.0.1:8288";
const appId = process.env.NATIVE_INNGEST_APP_ID ?? "research-app";
const selectedExampleIds = new Set(
  (process.env.NATIVE_INNGEST_EXAMPLE_IDS ?? "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean),
);

const inngest = new Inngest({ id: appId, isDev: true, baseUrl });

const exampleFiles = readdirSync(nativeDir)
  .filter((file) => /^\d+-.*\.ts$/.test(file))
  .sort();

const examples: Array<NativeExample> = [];

for (const file of exampleFiles) {
  const module = await import(pathToFileURL(join(nativeDir, file)).href);
  const factory = module.default as NativeExampleFactory | undefined;

  if (typeof factory !== "function") {
    throw new Error(`Native example ${file} must default-export defineNativeExample(...)`);
  }

  const example = factory(inngest);

  if (selectedExampleIds.size === 0 || selectedExampleIds.has(example.id)) {
    examples.push(example);
  }
}

const missingExampleIds = [...selectedExampleIds].filter((id) => !examples.some((example) => example.id === id));
if (missingExampleIds.length > 0) {
  throw new Error(`Unknown native example ids: ${missingExampleIds.join(", ")}`);
}

const functions = examples.flatMap((example) => example.functions);
const manifest = examples.map((example) => ({ id: example.id, cases: example.cases }));

const inngestHandler = serve({
  client: inngest,
  functions,
  serveOrigin,
  servePath,
});

Bun.serve({
  hostname: "127.0.0.1",
  port,
  fetch(request: Request) {
    const url = new URL(request.url);

    if (url.pathname === servePath) {
      return inngestHandler(request);
    }

    if (url.pathname === "/health") {
      return Response.json({ examples: examples.length, functions: functions.length, ok: true });
    }

    if (url.pathname === "/__native/examples") {
      return Response.json({ appId, examples: manifest });
    }

    return new Response("Not found", { status: 404 });
  },
});

console.log(
  `native inngest-js harness listening on http://127.0.0.1:${port}${servePath} with ${functions.length} functions`,
);
