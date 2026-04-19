/**
 * @module test/Signature.test
 * @description Tests for signature verification (I6.1)
 */

import * as Crypto from "node:crypto";
import { Effect, Result } from "effect";
import { describe, expect, it } from "../bun-effect.js";
import { Signature, SignatureError, SignatureLive } from "../../src/internal/signature.js";

// Test Fixtures

// Valid signing key format: signkey-{env}-{64_hex_chars}
const TEST_SIGNING_KEY = "signkey-test-" + Crypto.randomBytes(32).toString("hex");
const TEST_SIGNING_KEY_FALLBACK = "signkey-test-" + Crypto.randomBytes(32).toString("hex");

const TEST_BODY = new TextEncoder().encode('{"event":"test"}');

/**
 * Create a valid signature for testing.
 */
const createValidSignature = (body: Uint8Array, signingKey: string, timestampOverride?: number): string => {
  const timestamp = timestampOverride ?? Math.floor(Date.now() / 1000);
  const keyWithoutPrefix = signingKey.replace(/^signkey-\w+-/, "");
  const keyBytes = Buffer.from(keyWithoutPrefix, "hex");

  const hmac = Crypto.createHmac("sha256", keyBytes);
  hmac.update(body);
  hmac.update(String(timestamp));
  const signature = hmac.digest("hex");

  return `t=${timestamp}&s=${signature}`;
};

// Tests: verify()

describe("Signature.verify", () => {
  describe("dev mode", () => {
    it.effect("bypasses verification when isDev is true", () =>
      Effect.gen(function* () {
        const sig = yield* Signature;
        const result = yield* sig.verify({
          body: TEST_BODY,
          signatureHeader: undefined, // No signature
          signingKey: undefined, // No key
          isDev: true,
        });

        expect(result).toBe(true);
      }).pipe(Effect.provide(SignatureLive)),
    );

    it.effect("bypasses verification even with invalid signature in dev mode", () =>
      Effect.gen(function* () {
        const sig = yield* Signature;
        const result = yield* sig.verify({
          body: TEST_BODY,
          signatureHeader: "t=123&s=invalid",
          signingKey: TEST_SIGNING_KEY,
          isDev: true,
        });

        expect(result).toBe(true);
      }).pipe(Effect.provide(SignatureLive)),
    );
  });

  describe("production mode (isDev: false)", () => {
    it.effect("succeeds with valid signature", () =>
      Effect.gen(function* () {
        const sig = yield* Signature;
        const signature = createValidSignature(TEST_BODY, TEST_SIGNING_KEY);

        const result = yield* sig.verify({
          body: TEST_BODY,
          signatureHeader: signature,
          signingKey: TEST_SIGNING_KEY,
          isDev: false,
        });

        expect(result).toBe(true);
      }).pipe(Effect.provide(SignatureLive)),
    );

    it.effect("fails with missing signing key", () =>
      Effect.gen(function* () {
        const sig = yield* Signature;
        const signature = createValidSignature(TEST_BODY, TEST_SIGNING_KEY);

        const result = yield* sig
          .verify({
            body: TEST_BODY,
            signatureHeader: signature,
            signingKey: undefined,
            isDev: false,
          })
          .pipe(Effect.result);

        expect(Result.isFailure(result)).toBe(true);
        if (Result.isFailure(result)) {
          expect(result.failure.reason).toBe("missing_signing_key");
        }
      }).pipe(Effect.provide(SignatureLive)),
    );

    it.effect("fails with missing signature header", () =>
      Effect.gen(function* () {
        const sig = yield* Signature;
        const result = yield* sig
          .verify({
            body: TEST_BODY,
            signatureHeader: undefined,
            signingKey: TEST_SIGNING_KEY,
            isDev: false,
          })
          .pipe(Effect.result);

        expect(Result.isFailure(result)).toBe(true);
        if (Result.isFailure(result)) {
          expect(result.failure.reason).toBe("missing_header");
        }
      }).pipe(Effect.provide(SignatureLive)),
    );

    it.effect("fails with invalid signature format (missing t=)", () =>
      Effect.gen(function* () {
        const sig = yield* Signature;
        const result = yield* sig
          .verify({
            body: TEST_BODY,
            signatureHeader: "s=abc123",
            signingKey: TEST_SIGNING_KEY,
            isDev: false,
          })
          .pipe(Effect.result);

        expect(Result.isFailure(result)).toBe(true);
        if (Result.isFailure(result)) {
          expect(result.failure.reason).toBe("invalid_format");
        }
      }).pipe(Effect.provide(SignatureLive)),
    );

    it.effect("fails with invalid signature format (missing s=)", () =>
      Effect.gen(function* () {
        const sig = yield* Signature;
        const result = yield* sig
          .verify({
            body: TEST_BODY,
            signatureHeader: "t=123456",
            signingKey: TEST_SIGNING_KEY,
            isDev: false,
          })
          .pipe(Effect.result);

        expect(Result.isFailure(result)).toBe(true);
        if (Result.isFailure(result)) {
          expect(result.failure.reason).toBe("invalid_format");
        }
      }).pipe(Effect.provide(SignatureLive)),
    );

    it.effect("fails with expired signature (> 5 minutes old)", () =>
      Effect.gen(function* () {
        const sig = yield* Signature;
        // Create signature from 10 minutes ago
        const tenMinutesAgo = Math.floor(Date.now() / 1000) - 600;
        const signature = createValidSignature(TEST_BODY, TEST_SIGNING_KEY, tenMinutesAgo);

        const result = yield* sig
          .verify({
            body: TEST_BODY,
            signatureHeader: signature,
            signingKey: TEST_SIGNING_KEY,
            isDev: false,
          })
          .pipe(Effect.result);

        expect(Result.isFailure(result)).toBe(true);
        if (Result.isFailure(result)) {
          expect(result.failure.reason).toBe("expired");
        }
      }).pipe(Effect.provide(SignatureLive)),
    );

    it.effect("fails with future signature (> 5 minutes ahead)", () =>
      Effect.gen(function* () {
        const sig = yield* Signature;
        // Create signature from 10 minutes in the future
        const tenMinutesAhead = Math.floor(Date.now() / 1000) + 600;
        const signature = createValidSignature(TEST_BODY, TEST_SIGNING_KEY, tenMinutesAhead);

        const result = yield* sig
          .verify({
            body: TEST_BODY,
            signatureHeader: signature,
            signingKey: TEST_SIGNING_KEY,
            isDev: false,
          })
          .pipe(Effect.result);

        expect(Result.isFailure(result)).toBe(true);
        if (Result.isFailure(result)) {
          expect(result.failure.reason).toBe("expired");
        }
      }).pipe(Effect.provide(SignatureLive)),
    );

    it.effect("fails with invalid signature (wrong key)", () =>
      Effect.gen(function* () {
        const sig = yield* Signature;
        const differentKey = "signkey-test-" + Crypto.randomBytes(32).toString("hex");
        const signature = createValidSignature(TEST_BODY, differentKey);

        const result = yield* sig
          .verify({
            body: TEST_BODY,
            signatureHeader: signature,
            signingKey: TEST_SIGNING_KEY,
            isDev: false,
          })
          .pipe(Effect.result);

        expect(Result.isFailure(result)).toBe(true);
        if (Result.isFailure(result)) {
          expect(result.failure.reason).toBe("invalid_signature");
        }
      }).pipe(Effect.provide(SignatureLive)),
    );

    it.effect("fails with invalid signature (tampered body)", () =>
      Effect.gen(function* () {
        const sig = yield* Signature;
        const signature = createValidSignature(TEST_BODY, TEST_SIGNING_KEY);
        const tamperedBody = new TextEncoder().encode('{"event":"tampered"}');

        const result = yield* sig
          .verify({
            body: tamperedBody,
            signatureHeader: signature,
            signingKey: TEST_SIGNING_KEY,
            isDev: false,
          })
          .pipe(Effect.result);

        expect(Result.isFailure(result)).toBe(true);
        if (Result.isFailure(result)) {
          expect(result.failure.reason).toBe("invalid_signature");
        }
      }).pipe(Effect.provide(SignatureLive)),
    );

    it.effect("fails with invalid signature (wrong length - truncated)", () =>
      Effect.gen(function* () {
        const sig = yield* Signature;
        const timestamp = Math.floor(Date.now() / 1000);
        // Truncated signature (not 64 hex chars)
        const truncatedSig = `t=${timestamp}&s=abc123`;

        const result = yield* sig
          .verify({
            body: TEST_BODY,
            signatureHeader: truncatedSig,
            signingKey: TEST_SIGNING_KEY,
            isDev: false,
          })
          .pipe(Effect.result);

        expect(Result.isFailure(result)).toBe(true);
        if (Result.isFailure(result)) {
          expect(result.failure.reason).toBe("invalid_format");
        }
      }).pipe(Effect.provide(SignatureLive)),
    );
  });

  describe("fallback key", () => {
    it.effect("succeeds when primary key fails but fallback matches", () =>
      Effect.gen(function* () {
        const sig = yield* Signature;
        // Sign with fallback key
        const signature = createValidSignature(TEST_BODY, TEST_SIGNING_KEY_FALLBACK);

        const result = yield* sig.verify({
          body: TEST_BODY,
          signatureHeader: signature,
          signingKey: TEST_SIGNING_KEY, // Primary won't match
          signingKeyFallback: TEST_SIGNING_KEY_FALLBACK, // Fallback will match
          isDev: false,
        });

        expect(result).toBe(true);
      }).pipe(Effect.provide(SignatureLive)),
    );

    it.effect("fails when neither primary nor fallback matches", () =>
      Effect.gen(function* () {
        const sig = yield* Signature;
        const differentKey = "signkey-test-" + Crypto.randomBytes(32).toString("hex");
        const signature = createValidSignature(TEST_BODY, differentKey);

        const result = yield* sig
          .verify({
            body: TEST_BODY,
            signatureHeader: signature,
            signingKey: TEST_SIGNING_KEY,
            signingKeyFallback: TEST_SIGNING_KEY_FALLBACK,
            isDev: false,
          })
          .pipe(Effect.result);

        expect(Result.isFailure(result)).toBe(true);
        if (Result.isFailure(result)) {
          expect(result.failure.reason).toBe("invalid_signature");
        }
      }).pipe(Effect.provide(SignatureLive)),
    );
  });
});

// Tests: sign()

describe("Signature.sign", () => {
  it.effect("creates valid signature header format", () =>
    Effect.gen(function* () {
      const sig = yield* Signature;
      const header = yield* sig.sign(TEST_BODY, TEST_SIGNING_KEY);

      expect(header).toMatch(/^t=\d+&s=[a-f0-9]{64}$/);
    }).pipe(Effect.provide(SignatureLive)),
  );

  it.effect("creates signature that can be verified", () =>
    Effect.gen(function* () {
      const sig = yield* Signature;
      const header = yield* sig.sign(TEST_BODY, TEST_SIGNING_KEY);

      const result = yield* sig.verify({
        body: TEST_BODY,
        signatureHeader: header,
        signingKey: TEST_SIGNING_KEY,
        isDev: false,
      });

      expect(result).toBe(true);
    }).pipe(Effect.provide(SignatureLive)),
  );

  it.effect("uses current timestamp", () =>
    Effect.gen(function* () {
      const sig = yield* Signature;
      const before = Math.floor(Date.now() / 1000);
      const header = yield* sig.sign(TEST_BODY, TEST_SIGNING_KEY);
      const after = Math.floor(Date.now() / 1000);

      const match = header.match(/^t=(\d+)/);
      expect(match).not.toBeNull();
      if (!match) throw new Error("match should not be null");

      const timestamp = parseInt(match[1]!, 10);
      expect(timestamp).toBeGreaterThanOrEqual(before);
      expect(timestamp).toBeLessThanOrEqual(after);
    }).pipe(Effect.provide(SignatureLive)),
  );
});

// Tests: SignatureError

describe("SignatureError", () => {
  it("has correct _tag", () => {
    const error = new SignatureError({
      reason: "invalid_signature",
      message: "test",
    });

    expect(error._tag).toBe("SignatureError");
  });

  it("contains reason and message", () => {
    const error = new SignatureError({
      reason: "expired",
      message: "Signature expired",
    });

    expect(error.reason).toBe("expired");
    expect(error.message).toBe("Signature expired");
  });
});
