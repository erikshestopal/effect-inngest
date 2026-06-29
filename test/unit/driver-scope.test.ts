/**
 * @module test/unit/driver-scope
 * @description Tests for issue #3: Effect.acquireRelease finalizers never run
 * between requests — registered on application-level scope instead of per-request scope.
 *
 * @see https://github.com/erikshestopal/effect-inngest/issues/3
 */

import * as FetchHttpClient from "effect/unstable/http/FetchHttpClient";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";
import { describe, expect, it } from "@effect/vitest";

import { InngestFunction, InngestClient, InngestEvent } from "../../src/index.js";
import { execute } from "../../src/internal/driver.js";
import {
  SDKRequestBody,
  InngestEvent as ProtocolInngestEvent,
  SDKRequestContext,
  FunctionStack,
} from "../../src/internal/protocol.js";

// --- Fixtures ---

const TestEvent = InngestEvent.make(
  "test/scope-event",
  Schema.Struct({
    userId: Schema.String,
  }),
);

const testFn = InngestFunction.make("scope-test-fn", {
  trigger: { event: TestEvent },
});

const makeEvent = () => ProtocolInngestEvent.make({ name: "test/scope-event", data: { userId: "u1" }, id: "evt-1" });

const makeCtx = () =>
  SDKRequestContext.make({
    fn_id: "test-app-scope-test-fn",
    run_id: "run-1",
    env: "dev",
    step_id: "step",
    attempt: 0,
    max_attempts: 3,
    stack: FunctionStack.make({ stack: [], current: 0 }),
    qi_id: "",
    disable_immediate_execution: false,
    use_api: false,
  });

const makeRequest = () =>
  SDKRequestBody.make({
    event: makeEvent(),
    events: [makeEvent()],
    ctx: makeCtx(),
    steps: {},
    version: 1,
    use_api: false,
  });

const clientLayer = InngestClient.layer({ id: "test-app", mode: "dev" }).pipe(Layer.provide(FetchHttpClient.layer));

// --- Tests ---

describe("Issue #3: acquireRelease finalizers should run after handler completes", () => {
  it.effect("finalizer runs after step.run completes successfully", () =>
    Effect.gen(function* () {
      const finalizerRan = yield* Ref.make(false);

      const result = yield* execute({
        fn: testFn,
        handler: ({ step }) =>
          step.run(
            "work",
            Effect.acquireRelease(Effect.succeed("resource"), () => Ref.set(finalizerRan, true)),
          ),
        request: makeRequest(),
      }).pipe(Effect.provide(clientLayer));

      // The step.run always interrupts with a 206 on first execution
      expect(result.status).toBe(206);

      const ran = yield* Ref.get(finalizerRan);
      expect(ran).toBe(true);
    }),
  );

  it.effect("finalizer runs after step.run fails", () =>
    Effect.gen(function* () {
      const finalizerRan = yield* Ref.make(false);

      const result = yield* execute({
        fn: testFn,
        handler: ({ step }) =>
          step.run(
            "failing-step",
            Effect.acquireRelease(Effect.succeed("resource"), () => Ref.set(finalizerRan, true)).pipe(
              Effect.andThen(Effect.fail("boom")),
            ),
          ),
        request: makeRequest(),
      }).pipe(Effect.provide(clientLayer));

      expect(result.status).toBe(206);

      const ran = yield* Ref.get(finalizerRan);
      expect(ran).toBe(true);
    }),
  );

  it.effect("finalizer runs after step.run dies (defect)", () =>
    Effect.gen(function* () {
      const finalizerRan = yield* Ref.make(false);

      const result = yield* execute({
        fn: testFn,
        handler: ({ step }) =>
          step.run(
            "defect-step",
            Effect.acquireRelease(Effect.succeed("resource"), () => Ref.set(finalizerRan, true)).pipe(
              Effect.andThen(Effect.die("unexpected defect")),
            ),
          ),
        request: makeRequest(),
      }).pipe(Effect.provide(clientLayer));

      expect(result.status).toBe(206);

      const ran = yield* Ref.get(finalizerRan);
      expect(ran).toBe(true);
    }),
  );

  it.effect("finalizer runs for acquireRelease at handler level (outside steps)", () =>
    Effect.gen(function* () {
      const finalizerRan = yield* Ref.make(false);

      const handlerFn = InngestFunction.make("handler-scope-fn", {
        trigger: { event: TestEvent },
      });

      const result = yield* execute({
        fn: handlerFn,
        handler: () =>
          Effect.gen(function* () {
            yield* Effect.acquireRelease(Effect.succeed("resource"), () => Ref.set(finalizerRan, true));
            return "done";
          }),
        request: makeRequest(),
      }).pipe(Effect.provide(clientLayer));

      expect(result.status).toBe(200);

      const ran = yield* Ref.get(finalizerRan);
      expect(ran).toBe(true);
    }),
  );

  it.effect("multiple finalizers all run after handler completes", () =>
    Effect.gen(function* () {
      const finalizer1Ran = yield* Ref.make(false);
      const finalizer2Ran = yield* Ref.make(false);

      const handlerFn = InngestFunction.make("multi-finalizer-fn", {
        trigger: { event: TestEvent },
      });

      const result = yield* execute({
        fn: handlerFn,
        handler: () =>
          Effect.gen(function* () {
            yield* Effect.acquireRelease(Effect.succeed("r1"), () => Ref.set(finalizer1Ran, true));
            yield* Effect.acquireRelease(Effect.succeed("r2"), () => Ref.set(finalizer2Ran, true));
            return "done";
          }),
        request: makeRequest(),
      }).pipe(Effect.provide(clientLayer));

      expect(result.status).toBe(200);

      const ran1 = yield* Ref.get(finalizer1Ran);
      const ran2 = yield* Ref.get(finalizer2Ran);
      expect(ran1).toBe(true);
      expect(ran2).toBe(true);
    }),
  );
});
