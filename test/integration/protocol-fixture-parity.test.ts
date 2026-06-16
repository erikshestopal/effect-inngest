import * as Fs from "node:fs";
import * as Path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "@effect/vitest";
import * as Predicate from "effect/Predicate";

const rootDir = Path.resolve(Path.dirname(fileURLToPath(import.meta.url)), "../..");
const fixturesDir = Path.join(rootDir, "examples/fixtures");

const missingEffectAllowlist = new Set(["019-cron-trigger", "049-cron-timezone", "051-client-send"]);
const paritySkip = new Set(["055-system-events", "063-checkpointing-max-runtime"]);

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
  fixtureDirs().filter(
    (example) => hasFixture(example, "native") && hasFixture(example, "effect") && !paritySkip.has(example),
  );

const isRecord = (value: unknown): value is Record<string, Json> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const sortObject = (value: Record<string, Json>): Record<string, Json> =>
  Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)));

const pathEndsWith = (path: ReadonlyArray<string>, suffix: ReadonlyArray<string>) =>
  suffix.length <= path.length &&
  suffix.every((segment, index) => path[path.length - suffix.length + index] === segment);

const isNumericSegment = (segment: string) => /^\d+$/u.test(segment);

const isUlid = (value: string) => /^01[0-9A-HJKMNP-TV-Z]{24}$/u.test(value);

const isFixtureEventId = (value: string) => /^fixture-(native|effect)-/u.test(value);

const isEventIdOrTimestampPath = (path: ReadonlyArray<string>) => {
  const leaf = path.at(-1);
  if (leaf !== "id" && leaf !== "ts") {
    return false;
  }

  if (pathEndsWith(path, ["request", "body", "event", leaf])) {
    return true;
  }
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
  if (!path.includes("_inngest")) {
    return false;
  }
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

  if (pathEndsWith(path, ["ctx", "run_id"])) {
    return "<run_id>";
  }
  if (pathEndsWith(path, ["ctx", "qi_id"])) {
    return "<qi_id>";
  }
  if (pathEndsWith(path, ["ctx", "request_id"])) {
    return "<request_id>";
  }
  if (pathEndsWith(path, ["ctx", "job_id"])) {
    return "<job_id>";
  }

  if (pathEndsWith(path, ["body", "run_id"])) {
    return "<run_id>";
  }
  if (pathEndsWith(path, ["body", "qi_id"])) {
    return "<qi_id>";
  }
  if (pathEndsWith(path, ["body", "request_id"])) {
    return "<request_id>";
  }
  if (pathEndsWith(path, ["body", "request_started_at"])) {
    return "<request_started_at>";
  }
  if (pathEndsWith(path, ["body", "ts"])) {
    return "<checkpoint_ts>";
  }

  if (path.at(-1) === "stack" && typeof value === "string") {
    return "<stack>";
  }
  if (path.at(-1) === "id" && typeof value === "string" && (isUlid(value) || isFixtureEventId(value))) {
    return "<event-id>";
  }
  if (path.at(-1) === "ts" && (typeof value === "number" || typeof value === "string")) {
    return "<event-ts>";
  }
  if ((path.at(-1) === "timestamp" || path.at(-1) === "randomValue") && typeof value === "number") {
    return "<dynamic-number>";
  }
  if (path.at(-1) === "item" && typeof value === "string") {
    return "<batch-item>";
  }
  if (path.at(-1) === "fn_id" && typeof value === "string") {
    return "<fn_id>";
  }
  if (typeof value === "string" && isUlid(value)) {
    return "<ulid>";
  }
  if (typeof value === "string" && isFixtureEventId(value)) {
    return "<event-id>";
  }
  if (typeof value === "string" && isIsoTimestamp(value)) {
    return "<iso-timestamp>";
  }

  if (path.includes("timing") && typeof value === "number") {
    return "<timing>";
  }
  if (isDevInvokeMetadataPath(path)) {
    return `<${path.at(-1) ?? "metadata"}>`;
  }
  if (isEventIdOrTimestampPath(path)) {
    return path.at(-1) === "id" ? "<event-id>" : "<event-ts>";
  }

  return value;
};

const normalizeJson = (value: Json, path: ReadonlyArray<string> = []): Json => {
  if (Array.isArray(value)) {
    const normalizedItems = value.map((item, index) => normalizeJson(item, [...path, String(index)]));
    if (path.length === 0 && normalizedItems.every(isRecord)) {
      return [...normalizedItems].sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
    }
    if (path.at(-1) === "items" && normalizedItems.every((item) => typeof item === "string")) {
      return [...normalizedItems].sort() as ReadonlyArray<Json>;
    }
    if (
      normalizedItems.every(isRecord) &&
      normalizedItems.every((item) => Predicate.hasProperty(item, "name") && Predicate.hasProperty(item, "data"))
    ) {
      return [...normalizedItems].sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
    }
    return normalizedItems;
  }
  if (!isRecord(value)) {
    return normalizeLeaf(value, path);
  }

  if (typeof value.message === "string" && typeof value.stack === "string" && typeof value.name === "string") {
    return sortObject({ message: value.message, name: "<error-name>", stack: "<stack>" });
  }

  const normalized = Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => key !== "sequence")
      .filter(([key]) => !pathEndsWith([...path, key], ["request", "sequence"]))
      .filter(([key]) => key !== "checkpoint" || !path.includes("functions"))
      .filter(([key]) => !(value.op === "StepError" && ["data", "opts", "timing", "userland"].includes(key)))
      .filter(([key]) => key !== "timing")
      .filter(([key]) => key !== "__serialized")
      .map(([key, child]) => [key, normalizeJson(child, [...path, key])] as const),
  ) as Record<string, Json>;
  if (normalized.displayName === "capture-time" && typeof normalized.data === "number") {
    normalized.data = "<dynamic-number>";
  }
  if (normalized.displayName === "capture-random" && typeof normalized.data === "number") {
    normalized.data = "<dynamic-number>";
  }
  if (Object.keys(normalized).length === 1 && typeof normalized.data === "number") {
    normalized.data = "<dynamic-number>";
  }
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
