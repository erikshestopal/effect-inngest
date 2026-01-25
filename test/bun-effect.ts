/**
 * Minimal Effect test wrapper for Bun's native test runner.
 *
 * This provides `it.effect()` and `it.scoped()` that work with `bun:test`,
 * similar to `@effect/vitest`. When the official `@effect/bun-test` package
 * is released, replace this with that package.
 *
 * @see https://github.com/Effect-TS/effect/pull/5973
 *
 * @example
 * ```ts
 * import { describe, expect, it } from "./bun-effect"
 * import { Effect, Layer } from "effect"
 *
 * describe("my test", () => {
 *   it.effect("runs an effect", () =>
 *     Effect.gen(function* () {
 *       const result = yield* someEffect
 *       expect(result).toBe(expected)
 *     }).pipe(Effect.provide(TestLayer))
 *   )
 *
 *   it.scoped("runs a scoped effect", () =>
 *     Effect.gen(function* () {
 *       const resource = yield* acquireResource
 *       expect(resource).toBeDefined()
 *     })
 *   )
 *
 *   it.effect.skip("skipped test", () => Effect.succeed(1))
 *   it.effect.only("only this test", () => Effect.succeed(1))
 * })
 * ```
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { Effect, TestServices } from "effect";
import type { Scope } from "effect";

export { afterAll, afterEach, beforeAll, beforeEach, describe, expect };

type TestOptions = { timeout?: number };

const runTest = <E, A>(effect: Effect.Effect<A, E, TestServices.TestServices>) =>
  Effect.runPromise(effect.pipe(Effect.provide(TestServices.liveServices)));

const runTestScoped = <E, A>(effect: Effect.Effect<A, E, TestServices.TestServices | Scope.Scope>) =>
  Effect.runPromise(effect.pipe(Effect.scoped, Effect.provide(TestServices.liveServices)));

type EffectFn<A, E, R> = () => Effect.Effect<A, E, R>;

type EffectTester = {
  <A, E>(name: string, fn: EffectFn<A, E, TestServices.TestServices>, options?: number | TestOptions): void;
  skip: <A, E>(name: string, fn: EffectFn<A, E, TestServices.TestServices>, options?: number | TestOptions) => void;
  only: <A, E>(name: string, fn: EffectFn<A, E, TestServices.TestServices>, options?: number | TestOptions) => void;
};

type ScopedTester = {
  <A, E>(
    name: string,
    fn: EffectFn<A, E, TestServices.TestServices | Scope.Scope>,
    options?: number | TestOptions,
  ): void;
  skip: <A, E>(
    name: string,
    fn: EffectFn<A, E, TestServices.TestServices | Scope.Scope>,
    options?: number | TestOptions,
  ) => void;
  only: <A, E>(
    name: string,
    fn: EffectFn<A, E, TestServices.TestServices | Scope.Scope>,
    options?: number | TestOptions,
  ) => void;
};

const makeEffectTest =
  (runner: typeof test) =>
  <A, E>(name: string, fn: EffectFn<A, E, TestServices.TestServices>, options?: number | TestOptions) => {
    const timeout = typeof options === "number" ? options : options?.timeout;
    runner(name, () => runTest(fn()), timeout ? { timeout } : undefined);
  };

const makeScopedTest =
  (runner: typeof test) =>
  <A, E>(name: string, fn: EffectFn<A, E, TestServices.TestServices | Scope.Scope>, options?: number | TestOptions) => {
    const timeout = typeof options === "number" ? options : options?.timeout;
    runner(name, () => runTestScoped(fn()), timeout ? { timeout } : undefined);
  };

// Wrap .only in a function to avoid Bun's CI guard triggering at module load time.
// In CI, accessing test.only throws immediately - we defer the error to call time.
const effectOnly: EffectTester["only"] = (name, fn, options) => {
  const timeout = typeof options === "number" ? options : options?.timeout;
  test.only(name, () => runTest(fn()), timeout ? { timeout } : undefined);
};

const scopedOnly: ScopedTester["only"] = (name, fn, options) => {
  const timeout = typeof options === "number" ? options : options?.timeout;
  test.only(name, () => runTestScoped(fn()), timeout ? { timeout } : undefined);
};

export const effect: EffectTester = Object.assign(makeEffectTest(test), {
  skip: makeEffectTest(test.skip),
  only: effectOnly,
});

export const scoped: ScopedTester = Object.assign(makeScopedTest(test), {
  skip: makeScopedTest(test.skip),
  only: scopedOnly,
});

export const it = Object.assign(test, { effect, scoped });
