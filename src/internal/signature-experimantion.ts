/**
 * Experimental signature service shape.
 * @internal
 */
import * as NodeCrypto from "node:crypto";
import * as Context from "effect/Context";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Encoding from "effect/Encoding";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as SchemaTransformation from "effect/SchemaTransformation";
import * as Protocol from "./protocol.js";
import { SignatureError } from "./signature.js";
import { Predicate } from "effect";

export class SignatureConfig extends Schema.Class<SignatureConfig>("effect-inngest/SignatureConfig")({
  signingKey: Schema.optional(Schema.String),
  signingKeyFallback: Schema.optional(Schema.String),
  isDev: Schema.Boolean,
}) {}

type SignatureService = {
  readonly verify: (body: Uint8Array, signatureHeader: string | undefined) => Effect.Effect<void, SignatureError>;
  readonly sign: (body: Uint8Array) => Effect.Effect<string, SignatureError>;
};

const SIGNATURE_VALIDITY_WINDOW_MS = 5 * 60 * 1000;

const TimestampSeconds = Schema.NumberFromString.pipe(Schema.check(Schema.isInt(), Schema.isGreaterThan(0)));
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

const parseSignatureHeader = (header: string) => {
  const params = new URLSearchParams(header);
  return Schema.decodeUnknownEffect(SignatureParams)({ t: params.get("t") ?? "", s: params.get("s") ?? "" }).pipe(
    Effect.mapError(() =>
      SignatureError.make({
        reason: "invalid_format",
        message: `Invalid signature format: expected t=<int>&s=<64-hex>, got: ${header}`,
      }),
    ),
  );
};

export const hashSigningKey = (signingKey: string) =>
  Crypto.Crypto.pipe(
    Effect.flatMap((crypto) =>
      crypto.digest("SHA-256", new TextEncoder().encode(signingKey.replace(/^signkey-\w+-/, ""))),
    ),
    Effect.map(Encoding.encodeHex),
  );

export class Signature extends Context.Service<Signature, SignatureService>()("effect-inngest/SignatureExperiment", {
  make: (config: SignatureConfig) => {
    const signingKey = Predicate.isUndefined(config.signingKey)
      ? undefined
      : Buffer.from(config.signingKey.replace(/^signkey-\w+-/, ""), "hex");
    const signingKeys: Array<NodeCrypto.BinaryLike> = [];

    if (Predicate.isNotUndefined(signingKey)) {
      signingKeys.push(signingKey);
    }
    if (Predicate.isNotUndefined(config.signingKeyFallback)) {
      signingKeys.push(Buffer.from(config.signingKeyFallback.replace(/^signkey-\w+-/, ""), "hex"));
    }

    return Effect.succeed({
      verify: Effect.fn("effect-inngest/Signature/verify")(function* (
        body: Uint8Array,
        signatureHeader: string | undefined,
      ) {
        if (config.isDev) {
          return;
        }
        if (signingKeys.length === 0) {
          return yield* SignatureError.make({
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
        const signatureBytes = Buffer.from(signature, "hex");
        const valid = signingKeys.some((key) => {
          const expected = NodeCrypto.createHmac("sha256", key).update(body).update(timestamp).digest("hex");
          return (
            expected.length === signature.length &&
            NodeCrypto.timingSafeEqual(signatureBytes, Buffer.from(expected, "hex"))
          );
        });

        if (!valid) {
          return yield* new SignatureError({ reason: "invalid_signature", message: "Invalid signature" });
        }
      }),
      sign: Effect.fn("effect-inngest/Signature/sign")(function* (body: Uint8Array) {
        if (signingKey === undefined) {
          return yield* SignatureError.make({
            reason: "missing_signing_key",
            message: "No signing key configured for production mode",
          });
        }

        const now = yield* DateTime.now;
        const timestamp = String(Math.floor(now.epochMilliseconds / 1000));
        return `t=${timestamp}&s=${NodeCrypto.createHmac("sha256", signingKey)
          .update(body)
          .update(timestamp)
          .digest("hex")}`;
      }),
    });
  },
}) {
  static readonly layer = (config: SignatureConfig): Layer.Layer<Signature> => Layer.effect(this, this.make(config));
}
