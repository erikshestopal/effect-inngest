/**
 * Signature verification service for Inngest requests.
 * @internal
 */
import * as Crypto from "node:crypto";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as SchemaTransformation from "effect/SchemaTransformation";
import * as Protocol from "./protocol.js";

/**
 * @internal
 */
export class SignatureError extends Schema.TaggedErrorClass<SignatureError>()("SignatureError", {
  reason: Schema.Literals(["missing_header", "invalid_format", "expired", "invalid_signature", "missing_signing_key"]),
  message: Schema.String,
}) {}

/**
 * @internal
 */
export interface VerifyOptions {
  readonly body: Uint8Array;
  readonly signatureHeader: string | undefined;
  readonly signingKey: string | undefined;
  readonly signingKeyFallback?: string | undefined;
  readonly isDev: boolean;
}

/**
 * @internal
 */
export interface SignatureService {
  readonly verify: (options: VerifyOptions) => Effect.Effect<boolean, SignatureError>;
  readonly sign: (body: Uint8Array, signingKey: string) => Effect.Effect<string, SignatureError>;
}

/**
 * @internal
 */
export class Signature extends Context.Service<Signature, SignatureService>()("effect-inngest/Signature") {}

// ─────────────────────────────────────────────────────────────
// Schemas (internal)
// ─────────────────────────────────────────────────────────────

const TimestampSeconds = Schema.NumberFromString.pipe(Schema.check(Schema.isInt(), Schema.isGreaterThan(0)));
// Case-insensitive hex, normalized to lowercase in parseSignatureHeader
const SignatureHex = Schema.String.pipe(
  Schema.check(Schema.isPattern(/^[a-fA-F0-9]{64}$/)),
  Schema.decodeTo(
    Schema.String,
    SchemaTransformation.transform({
      decode: (s) => s.toLowerCase(),
      encode: (s) => s,
    }),
  ),
);
const SignatureParams = Schema.Struct({ t: TimestampSeconds, s: SignatureHex });

// ─────────────────────────────────────────────────────────────
// Internal helpers
// ─────────────────────────────────────────────────────────────

const SIGNATURE_VALIDITY_WINDOW_MS = 5 * 60 * 1000;

const parseSignatureHeader = (header: string) => {
  const params = new URLSearchParams(header);
  const raw = { t: params.get("t") ?? "", s: params.get("s") ?? "" };
  return Schema.decodeUnknownEffect(SignatureParams)(raw).pipe(
    Effect.mapError(
      () =>
        new SignatureError({
          reason: "invalid_format",
          message: `Invalid signature format: expected t=<int>&s=<64-hex>, got: ${header}`,
        }),
    ),
  );
};

const extractKeyBytes = (signingKey: string): Buffer => {
  const keyWithoutPrefix = signingKey.replace(/^signkey-\w+-/, "");
  return Buffer.from(keyWithoutPrefix, "hex");
};

/**
 * SHA-256 hex of the signing key with the `signkey-{prefix}-` prefix stripped.
 * Used as the Bearer token for outbound requests to the Inngest API per spec
 * §4.1.1.
 *
 * @internal
 */
export const hashSigningKey = (signingKey: string): string => {
  const keyWithoutPrefix = signingKey.replace(/^signkey-\w+-/, "");
  return Crypto.createHash("sha256").update(keyWithoutPrefix).digest("hex");
};

const computeSignature = (keyBytes: Buffer, body: Uint8Array, timestamp: string): string =>
  Crypto.createHmac("sha256", keyBytes).update(body).update(timestamp).digest("hex");

const timingSafeEqual = (a: string, b: string): boolean => {
  if (a.length !== b.length) {
    return false;
  }
  try {
    return Crypto.timingSafeEqual(Buffer.from(a, "hex"), Buffer.from(b, "hex"));
  } catch {
    return false;
  }
};

const checkSignature = (signature: string, body: Uint8Array, timestamp: string, signingKey: string): boolean => {
  const keyBytes = extractKeyBytes(signingKey);
  const expected = computeSignature(keyBytes, body, timestamp);
  return timingSafeEqual(signature, expected);
};

// ─────────────────────────────────────────────────────────────
// Live Layer
// ─────────────────────────────────────────────────────────────

/**
 * @internal
 */
export const SignatureLive: Layer.Layer<Signature> = Layer.succeed(Signature, {
  verify: Effect.fn("Signature.verify")(function* ({
    body,
    signatureHeader,
    signingKey,
    signingKeyFallback,
    isDev,
  }: VerifyOptions) {
    if (isDev) {
      return true;
    }
    if (!signingKey) {
      return yield* new SignatureError({
        reason: "missing_signing_key",
        message: "No signing key configured for production mode",
      });
    }

    if (!signatureHeader) {
      return yield* new SignatureError({
        reason: "missing_header",
        message: `Missing ${Protocol.Headers.Signature} header`,
      });
    }

    const { t: timestampSeconds, s: signature } = yield* parseSignatureHeader(signatureHeader);
    const timestampMs = timestampSeconds * 1000;
    const now = yield* DateTime.now;

    if (Math.abs(now.epochMilliseconds - timestampMs) > SIGNATURE_VALIDITY_WINDOW_MS) {
      return yield* new SignatureError({
        reason: "expired",
        message: `Signature expired: timestamp ${timestampSeconds} is outside the validity window`,
      });
    }

    const timestamp = String(timestampSeconds);
    const keys = [signingKey, signingKeyFallback].filter(Boolean) as string[];
    const valid = keys.some((key) => checkSignature(signature, body, timestamp, key));

    if (valid) {
      return true;
    }

    return yield* new SignatureError({ reason: "invalid_signature", message: "Invalid signature" });
  }),

  sign: (body, signingKey) =>
    DateTime.now.pipe(
      Effect.map((now) => {
        const ts = Math.floor(now.epochMilliseconds / 1000);
        return `t=${ts}&s=${computeSignature(extractKeyBytes(signingKey), body, String(ts))}`;
      }),
    ),
});
