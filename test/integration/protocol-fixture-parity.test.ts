import * as Fs from "node:fs";
import * as Path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "@effect/vitest";

const rootDir = Path.resolve(Path.dirname(fileURLToPath(import.meta.url)), "../..");
const fixturesDir = Path.join(rootDir, "examples/fixtures");

const missingEffectAllowlist = new Set(["019-cron-trigger", "049-cron-timezone", "051-client-send"]);

type Json = null | boolean | number | string | ReadonlyArray<Json> | { readonly [key: string]: Json };

const readJson = (path: string): Json => JSON.parse(Fs.readFileSync(path, "utf8")) as Json;

const fixtureDirs = () =>
  Fs.readdirSync(fixturesDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();

const hasFixture = (example: string, runtime: "native" | "effect") =>
  Fs.existsSync(Path.join(fixturesDir, example, `${runtime}.json`));

const pairedExamples = () =>
  fixtureDirs().filter((example) => hasFixture(example, "native") && hasFixture(example, "effect"));

const isRecord = (value: unknown): value is Record<string, Json> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const sortObject = (value: Record<string, Json>): Record<string, Json> =>
  Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)));

const pathEndsWith = (path: ReadonlyArray<string>, suffix: ReadonlyArray<string>) =>
  suffix.length <= path.length &&
  suffix.every((segment, index) => path[path.length - suffix.length + index] === segment);

const isNumericSegment = (segment: string) => /^\d+$/u.test(segment);

const isEventIdOrTimestampPath = (path: ReadonlyArray<string>) => {
  const leaf = path.at(-1);
  if (leaf !== "id" && leaf !== "ts") return false;

  if (pathEndsWith(path, ["request", "body", "event", leaf])) return true;
  if (path.length >= 5 && path[path.length - 3] === "events" && isNumericSegment(path[path.length - 2] ?? "")) {
    return pathEndsWith(path.slice(0, -3), ["request", "body"]);
  }
  if (path.length >= 4 && path[path.length - 3] === "body" && isNumericSegment(path[path.length - 2] ?? "")) {
    return pathEndsWith(path.slice(0, -3), ["request"]);
  }
  if (path.length >= 5 && path[path.length - 4] === "steps" && path[path.length - 2] === "data") {
    return pathEndsWith(path.slice(0, -4), ["request", "body"]);
  }
  if (path.length >= 4 && path[path.length - 3] === "steps") {
    return pathEndsWith(path.slice(0, -3), ["request", "body"]);
  }

  return false;
};

const normalizeUrlString = (value: string) =>
  value
    .replace("http://localhost:", "http://127.0.0.1:")
    .replace(/\/v1\/checkpoint\/[^/]+\/async/u, "/v1/checkpoint/<run_id>/async");

const isIsoTimestamp = (value: string) => /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value);

const isDevInvokeMetadataPath = (path: ReadonlyArray<string>) => {
  if (!path.includes("_inngest")) return false;
  const leaf = path.at(-1);
  return (
    leaf === "correlation_id" ||
    leaf === "expire" ||
    leaf === "gid" ||
    leaf === "dsid" ||
    leaf === "dstp" ||
    leaf === "tp" ||
    leaf === "sid" ||
    leaf === "source_fn_v" ||
    leaf === "traceparent" ||
    leaf === "ts"
  );
};

const normalizeLeaf = (value: Json, path: ReadonlyArray<string>): Json => {
  if (pathEndsWith(path, ["request", "path"]) || pathEndsWith(path, ["request", "url"])) {
    return typeof value === "string" ? normalizeUrlString(value) : value;
  }

  if (pathEndsWith(path, ["ctx", "run_id"])) return "<run_id>";
  if (pathEndsWith(path, ["ctx", "qi_id"])) return "<qi_id>";
  if (pathEndsWith(path, ["ctx", "request_id"])) return "<request_id>";
  if (pathEndsWith(path, ["ctx", "job_id"])) return "<job_id>";

  if (pathEndsWith(path, ["body", "run_id"])) return "<run_id>";
  if (pathEndsWith(path, ["body", "qi_id"])) return "<qi_id>";
  if (pathEndsWith(path, ["body", "request_id"])) return "<request_id>";
  if (pathEndsWith(path, ["body", "request_started_at"])) return "<request_started_at>";
  if (pathEndsWith(path, ["body", "ts"])) return "<checkpoint_ts>";

  if (path.includes("timing") && typeof value === "number") return "<timing>";
  if (isDevInvokeMetadataPath(path)) return `<${path.at(-1) ?? "metadata"}>`;
  if (isEventIdOrTimestampPath(path)) return path.at(-1) === "id" ? "<event-id>" : "<event-ts>";
  if (pathEndsWith(path, ["name"]) && typeof value === "string" && isIsoTimestamp(value)) return "<iso-timestamp>";

  return value;
};

const normalizeJson = (value: Json, path: ReadonlyArray<string> = []): Json => {
  if (Array.isArray(value)) return value.map((item, index) => normalizeJson(item, [...path, String(index)]));
  if (!isRecord(value)) return normalizeLeaf(value, path);

  const normalized = Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => !pathEndsWith([...path, key], ["request", "sequence"]))
      .map(([key, child]) => [key, normalizeJson(child, [...path, key])] as const),
  ) as Record<string, Json>;
  return sortObject(normalized);
};

describe("native/effect protocol fixture parity", () => {
  it("has no unexpected missing fixture pairs", () => {
    const missingEffect = fixtureDirs().filter(
      (example) => hasFixture(example, "native") && !hasFixture(example, "effect"),
    );
    const unexpectedMissingEffect = missingEffect.filter((example) => !missingEffectAllowlist.has(example));
    const staleAllowlist = [...missingEffectAllowlist].filter((example) => hasFixture(example, "effect"));
    const missingNative = fixtureDirs().filter(
      (example) => hasFixture(example, "effect") && !hasFixture(example, "native"),
    );

    expect(unexpectedMissingEffect).toEqual([]);
    expect(staleAllowlist).toEqual([]);
    expect(missingNative).toEqual([]);
  });

  for (const example of pairedExamples()) {
    it(`matches native fixture after strict normalization: ${example}`, () => {
      const native = normalizeJson(readJson(Path.join(fixturesDir, example, "native.json")));
      const effect = normalizeJson(readJson(Path.join(fixturesDir, example, "effect.json")));

      expect(effect).toEqual(native);
    });
  }
});
