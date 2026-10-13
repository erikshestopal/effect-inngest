/**
 * @module test/Signature.test
 * @description Tests for signature verification (I6.1)
 */

import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Result from "effect/Result";
import * as TestClock from "effect/testing/TestClock";
import { describe, expect, it } from "@effect/vitest";
import {
  Signature,
  SignatureConfig,
  SignatureError,
  SignatureHeader,
  SignedPayload,
} from "../../src/internal/serve/Signature.js";

const TEST_SIGNING_KEY = "signkey-test-0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
const TEST_SIGNING_KEY_FALLBACK = "signkey-test-fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210";
const TEST_BODY = new TextEncoder().encode('{"event":"test"}');
const TEST_TIMESTAMP = 1760000000;

const NATIVE_SIGNATURE = `t=${TEST_TIMESTAMP}&s=ee30fdb49e6d49a36d344b0a17b53b56ffa8aaca20fcc916a7b8eb61dc5d7426`;
const NATIVE_FALLBACK_SIGNATURE = `t=${TEST_TIMESTAMP}&s=581372ae5556fd23f8b3521d1a153b9cbe36f2990a94117ca463fcac180b7053`;

const atSignatureTime = (offsetSeconds = 0) => TestClock.setTime((TEST_TIMESTAMP + offsetSeconds) * 1000);

const layer = (config: {
  readonly verification: "disabled" | "required";
  readonly signingKey?: string | undefined;
  readonly signingKeyFallback?: string | undefined;
}) =>
  Signature.layer(
    SignatureConfig.make({
      verification: config.verification,
      signingKey: Option.fromNullishOr(config.signingKey),
      signingKeyFallback: Option.fromNullishOr(config.signingKeyFallback),
    }),
  );

const payload = (body: Uint8Array, signatureHeader?: string) =>
  Option.match(Option.fromNullishOr(signatureHeader), {
    onNone: () => Effect.succeed(SignedPayload.make({ body, signature: Option.none() })),
    onSome: (header) =>
      SignatureHeader.decode(header).pipe(
        Effect.map((signature) => SignedPayload.make({ body, signature: Option.some(signature) })),
      ),
  });

describe("Signature.verify", () => {
  describe("disabled verification", () => {
    it.live("bypasses missing signature and signing key", () =>
      Effect.gen(function* () {
        const sig = yield* Signature;
        yield* sig.verify(SignedPayload.make({ body: TEST_BODY, signature: Option.none() }));
      }).pipe(Effect.provide(layer({ verification: "disabled" }))),
    );

    it.live("bypasses invalid signature", () =>
      Effect.gen(function* () {
        const sig = yield* Signature;
        yield* sig.verify(SignedPayload.make({ body: TEST_BODY, signature: Option.none() }));
      }).pipe(Effect.provide(layer({ verification: "disabled", signingKey: TEST_SIGNING_KEY }))),
    );

    it.live("bypasses invalid configured signing key", () =>
      Effect.gen(function* () {
        const sig = yield* Signature;
        yield* sig.verify(SignedPayload.make({ body: TEST_BODY, signature: Option.none() }));
      }).pipe(Effect.provide(layer({ verification: "disabled", signingKey: "local" }))),
    );
  });

  describe("required verification", () => {
    it.effect("accepts the signature the native SDK computes", () =>
      Effect.gen(function* () {
        yield* atSignatureTime();
        const sig = yield* Signature;
        yield* sig.verify(yield* payload(TEST_BODY, NATIVE_SIGNATURE));
      }).pipe(Effect.provide(layer({ verification: "required", signingKey: TEST_SIGNING_KEY }))),
    );

    it.live("fails with missing signing key", () =>
      Effect.gen(function* () {
        const sig = yield* Signature;
        const result = yield* sig.verify(yield* payload(TEST_BODY, NATIVE_SIGNATURE)).pipe(Effect.result);

        expect(Result.isFailure(result)).toBe(true);
        if (Result.isFailure(result)) {
          expect(result.failure.reason).toBe("missing_signing_key");
        }
      }).pipe(Effect.provide(layer({ verification: "required" }))),
    );

    it.live("fails with missing signature header", () =>
      Effect.gen(function* () {
        const sig = yield* Signature;
        const result = yield* sig
          .verify(SignedPayload.make({ body: TEST_BODY, signature: Option.none() }))
          .pipe(Effect.result);

        expect(Result.isFailure(result)).toBe(true);
        if (Result.isFailure(result)) {
          expect(result.failure.reason).toBe("missing_header");
        }
      }).pipe(Effect.provide(layer({ verification: "required", signingKey: TEST_SIGNING_KEY }))),
    );

    it.live("fails with invalid signature format", () =>
      Effect.gen(function* () {
        const result = yield* payload(TEST_BODY, "s=abc123").pipe(Effect.result);

        expect(Result.isFailure(result)).toBe(true);
        if (Result.isFailure(result)) {
          expect(result.failure.reason).toBe("invalid_format");
        }
      }),
    );

    it.effect("fails with expired signature", () =>
      Effect.gen(function* () {
        yield* atSignatureTime(600);
        const sig = yield* Signature;
        const result = yield* sig.verify(yield* payload(TEST_BODY, NATIVE_SIGNATURE)).pipe(Effect.result);

        expect(Result.isFailure(result)).toBe(true);
        if (Result.isFailure(result)) {
          expect(result.failure.reason).toBe("expired");
        }
      }).pipe(Effect.provide(layer({ verification: "required", signingKey: TEST_SIGNING_KEY }))),
    );

    it.effect("fails with future signature", () =>
      Effect.gen(function* () {
        yield* atSignatureTime(-600);
        const sig = yield* Signature;
        const result = yield* sig.verify(yield* payload(TEST_BODY, NATIVE_SIGNATURE)).pipe(Effect.result);

        expect(Result.isFailure(result)).toBe(true);
        if (Result.isFailure(result)) {
          expect(result.failure.reason).toBe("expired");
        }
      }).pipe(Effect.provide(layer({ verification: "required", signingKey: TEST_SIGNING_KEY }))),
    );

    it.effect("fails with wrong key", () =>
      Effect.gen(function* () {
        yield* atSignatureTime();
        const sig = yield* Signature;
        const result = yield* sig.verify(yield* payload(TEST_BODY, NATIVE_FALLBACK_SIGNATURE)).pipe(Effect.result);

        expect(Result.isFailure(result)).toBe(true);
        if (Result.isFailure(result)) {
          expect(result.failure.reason).toBe("invalid_signature");
        }
      }).pipe(Effect.provide(layer({ verification: "required", signingKey: TEST_SIGNING_KEY }))),
    );

    it.effect("fails with tampered body", () =>
      Effect.gen(function* () {
        yield* atSignatureTime();
        const sig = yield* Signature;
        const tamperedBody = new TextEncoder().encode('{"event":"tampered"}');
        const result = yield* sig.verify(yield* payload(tamperedBody, NATIVE_SIGNATURE)).pipe(Effect.result);

        expect(Result.isFailure(result)).toBe(true);
        if (Result.isFailure(result)) {
          expect(result.failure.reason).toBe("invalid_signature");
        }
      }).pipe(Effect.provide(layer({ verification: "required", signingKey: TEST_SIGNING_KEY }))),
    );

    it.effect("succeeds when fallback key matches", () =>
      Effect.gen(function* () {
        yield* atSignatureTime();
        const sig = yield* Signature;
        yield* sig.verify(yield* payload(TEST_BODY, NATIVE_FALLBACK_SIGNATURE));
      }).pipe(
        Effect.provide(
          layer({
            verification: "required",
            signingKey: TEST_SIGNING_KEY,
            signingKeyFallback: TEST_SIGNING_KEY_FALLBACK,
          }),
        ),
      ),
    );
  });
});

describe("Signature.sign", () => {
  it.effect("signs like the native SDK", () =>
    Effect.gen(function* () {
      yield* atSignatureTime();
      const sig = yield* Signature;
      const header = yield* sig.sign(TEST_BODY);

      expect(header).toBe(NATIVE_SIGNATURE);
    }).pipe(Effect.provide(layer({ verification: "required", signingKey: TEST_SIGNING_KEY }))),
  );

  it.live("creates signature that can be verified", () =>
    Effect.gen(function* () {
      const sig = yield* Signature;
      const header = yield* sig.sign(TEST_BODY);

      yield* sig.verify(yield* payload(TEST_BODY, header));
    }).pipe(Effect.provide(layer({ verification: "required", signingKey: TEST_SIGNING_KEY }))),
  );

  it.live("fails without configured signing key", () =>
    Effect.gen(function* () {
      const sig = yield* Signature;
      const result = yield* sig.sign(TEST_BODY).pipe(Effect.result);

      expect(Result.isFailure(result)).toBe(true);
      if (Result.isFailure(result)) {
        expect(result.failure.reason).toBe("missing_signing_key");
      }
    }).pipe(Effect.provide(layer({ verification: "disabled" }))),
  );

  it.live("fails with invalid configured signing key", () =>
    Effect.gen(function* () {
      const sig = yield* Signature;
      const result = yield* sig.sign(TEST_BODY).pipe(Effect.result);

      expect(Result.isFailure(result)).toBe(true);
      if (Result.isFailure(result)) {
        expect(result.failure.reason).toBe("invalid_format");
      }
    }).pipe(Effect.provide(layer({ verification: "disabled", signingKey: "local" }))),
  );
});

describe("SignatureError", () => {
  it("has correct _tag", () => {
    const error = new SignatureError({ reason: "invalid_signature", message: "test" });

    expect(error._tag).toBe("SignatureError");
  });

  it("contains reason and message", () => {
    const error = new SignatureError({ reason: "expired", message: "Signature expired" });

    expect(error.reason).toBe("expired");
    expect(error.message).toBe("Signature expired");
  });
});
