/**
 * @module test/Signature.test
 * @description Tests for signature verification (I6.1)
 */

import * as Crypto from "node:crypto";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Result from "effect/Result";
import { describe, expect, it } from "@effect/vitest";
import {
  Signature,
  SignatureConfig,
  SignatureError,
  SignatureHeader,
  SignedPayload,
} from "../../src/internal/signature.js";

const TEST_SIGNING_KEY = "signkey-test-" + Crypto.randomBytes(32).toString("hex");
const TEST_SIGNING_KEY_FALLBACK = "signkey-test-" + Crypto.randomBytes(32).toString("hex");
const TEST_BODY = new TextEncoder().encode('{"event":"test"}');

const createValidSignature = (body: Uint8Array, signingKey: string, timestampOverride?: number): string => {
  const timestamp = timestampOverride ?? Math.floor(Date.now() / 1000);
  const keyBytes = Buffer.from(signingKey.replace(/^signkey-\w+-/, ""), "hex");
  const signature = Crypto.createHmac("sha256", keyBytes).update(body).update(String(timestamp)).digest("hex");

  return `t=${timestamp}&s=${signature}`;
};

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
  });

  describe("required verification", () => {
    it.live("succeeds with valid signature", () =>
      Effect.gen(function* () {
        const sig = yield* Signature;
        yield* sig.verify(yield* payload(TEST_BODY, createValidSignature(TEST_BODY, TEST_SIGNING_KEY)));
      }).pipe(Effect.provide(layer({ verification: "required", signingKey: TEST_SIGNING_KEY }))),
    );

    it.live("fails with missing signing key", () =>
      Effect.gen(function* () {
        const sig = yield* Signature;
        const result = yield* sig
          .verify(yield* payload(TEST_BODY, createValidSignature(TEST_BODY, TEST_SIGNING_KEY)))
          .pipe(Effect.result);

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

    it.live("fails with expired signature", () =>
      Effect.gen(function* () {
        const sig = yield* Signature;
        const signature = createValidSignature(TEST_BODY, TEST_SIGNING_KEY, Math.floor(Date.now() / 1000) - 600);
        const result = yield* sig.verify(yield* payload(TEST_BODY, signature)).pipe(Effect.result);

        expect(Result.isFailure(result)).toBe(true);
        if (Result.isFailure(result)) {
          expect(result.failure.reason).toBe("expired");
        }
      }).pipe(Effect.provide(layer({ verification: "required", signingKey: TEST_SIGNING_KEY }))),
    );

    it.live("fails with future signature", () =>
      Effect.gen(function* () {
        const sig = yield* Signature;
        const signature = createValidSignature(TEST_BODY, TEST_SIGNING_KEY, Math.floor(Date.now() / 1000) + 600);
        const result = yield* sig.verify(yield* payload(TEST_BODY, signature)).pipe(Effect.result);

        expect(Result.isFailure(result)).toBe(true);
        if (Result.isFailure(result)) {
          expect(result.failure.reason).toBe("expired");
        }
      }).pipe(Effect.provide(layer({ verification: "required", signingKey: TEST_SIGNING_KEY }))),
    );

    it.live("fails with wrong key", () =>
      Effect.gen(function* () {
        const sig = yield* Signature;
        const differentKey = "signkey-test-" + Crypto.randomBytes(32).toString("hex");
        const result = yield* sig
          .verify(yield* payload(TEST_BODY, createValidSignature(TEST_BODY, differentKey)))
          .pipe(Effect.result);

        expect(Result.isFailure(result)).toBe(true);
        if (Result.isFailure(result)) {
          expect(result.failure.reason).toBe("invalid_signature");
        }
      }).pipe(Effect.provide(layer({ verification: "required", signingKey: TEST_SIGNING_KEY }))),
    );

    it.live("fails with tampered body", () =>
      Effect.gen(function* () {
        const sig = yield* Signature;
        const tamperedBody = new TextEncoder().encode('{"event":"tampered"}');
        const result = yield* sig
          .verify(yield* payload(tamperedBody, createValidSignature(TEST_BODY, TEST_SIGNING_KEY)))
          .pipe(Effect.result);

        expect(Result.isFailure(result)).toBe(true);
        if (Result.isFailure(result)) {
          expect(result.failure.reason).toBe("invalid_signature");
        }
      }).pipe(Effect.provide(layer({ verification: "required", signingKey: TEST_SIGNING_KEY }))),
    );

    it.live("succeeds when fallback key matches", () =>
      Effect.gen(function* () {
        const sig = yield* Signature;
        yield* sig.verify(yield* payload(TEST_BODY, createValidSignature(TEST_BODY, TEST_SIGNING_KEY_FALLBACK)));
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
  it.live("creates valid signature header format", () =>
    Effect.gen(function* () {
      const sig = yield* Signature;
      const header = yield* sig.sign(TEST_BODY);

      expect(header).toMatch(/^t=\d+&s=[a-f0-9]{64}$/);
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
