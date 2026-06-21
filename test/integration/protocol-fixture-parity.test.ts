import * as Fs from "node:fs";
import * as Path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "@effect/vitest";
import type { CanonicalFixture } from "../../examples/protocol-canonical.ts";

const rootDir = Path.resolve(Path.dirname(fileURLToPath(import.meta.url)), "../..");
const fixturesDir = Path.join(rootDir, "examples/fixtures");

const missingEffectAllowlist = new Set<string>();
const paritySkip = new Set(["055-system-events", "063-checkpointing-max-runtime"]);

const readFixture = (path: string): CanonicalFixture => JSON.parse(Fs.readFileSync(path, "utf8")) as CanonicalFixture;

const fixtureDirs = () =>
  Fs.readdirSync(fixturesDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith("_"))
    .map((entry) => entry.name)
    .sort();

const hasFixture = (example: string, runtime: "native" | "effect") =>
  Fs.existsSync(Path.join(fixturesDir, example, `${runtime}.json`));

const pairedExamples = () =>
  fixtureDirs().filter(
    (example) => hasFixture(example, "native") && hasFixture(example, "effect") && !paritySkip.has(example),
  );

const comparable = (fixture: CanonicalFixture) => ({
  ...fixture,
  runtime: "<runtime>",
});

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
    it(`matches canonical native fixture: ${example}`, () => {
      const native = readFixture(Path.join(fixturesDir, example, "native.json"));
      const effect = readFixture(Path.join(fixturesDir, example, "effect.json"));

      expect(native.schema).toBe("inngest-protocol-canonical/v1");
      expect(effect.schema).toBe("inngest-protocol-canonical/v1");
      expect(comparable(effect)).toEqual(comparable(native));
    });
  }
});
