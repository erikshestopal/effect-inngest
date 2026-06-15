/**
 * Signature verification service for Inngest requests.
 * @internal
 */
import * as NodeCrypto from "node:crypto";
import { Array as Arr, Context, DateTime, Encoding, Effect, Layer, Option, Schema } from "effect";
import { InngestClient } from "../Client.js";

export class SignatureError extends Schema.TaggedErrorClass<SignatureError>()("SignatureError", {
  reason: Schema.Literals(["missing_header", "invalid_format", "expired", "invalid_signature", "missing_signing_key"]),
  message: Schema.String,
}) {}

export class SignatureConfig extends Schema.Class<SignatureConfig>("effect-inngest/SignatureConfig")({
  verification: Schema.Literals(["disabled", "required"]),
  signingKey: Schema.OptionFromUndefinedOr(Schema.String),
  signingKeyFallback: Schema.OptionFromUndefinedOr(Schema.String),
}) {}

export class PreparedSigningKey extends Schema.Class<PreparedSigningKey>("effect-inngest/PreparedSigningKey")({
  bytes: Schema.Uint8Array,
}) {
  static readonly decode = (signingKey: string) =>
    Schema.decodeUnknownOption(Schema.Uint8ArrayFromHex)(signingKey.replace(/^signkey-\w+-/, "")).pipe(
      Option.map((bytes) => PreparedSigningKey.make({ bytes })),
    );

  readonly sign = (body: Uint8Array, timestampSeconds: number) =>
    NodeCrypto.createHmac("sha256", this.bytes).update(body).update(String(timestampSeconds)).digest();

  readonly verifies = (body: Uint8Array, header: SignatureHeader) => {
    const expected = this.sign(body, header.timestampSeconds);
    return expected.length === header.signature.length && NodeCrypto.timingSafeEqual(expected, header.signature);
  };
}

export class SignatureHeader extends Schema.Class<SignatureHeader>("effect-inngest/SignatureHeader")({
  timestampSeconds: Schema.Number,
  signature: Schema.Uint8Array,
}) {
  static readonly decode = (header: string) => {
    const params = new URLSearchParams(header);
    const decode = Schema.decodeUnknownEffect(SignatureParams);

    return decode({ t: params.get("t") ?? "", s: params.get("s") ?? "" }).pipe(
      Effect.map(({ t, s }) => SignatureHeader.make({ timestampSeconds: t, signature: s })),
      Effect.mapError(() =>
        SignatureError.make({
          reason: "invalid_format",
          message: `Invalid signature format: expected t=<int>&s=<64-hex>, got: ${header}`,
        }),
      ),
    );
  };

  readonly assertFresh = Effect.fn("effect-inngest/SignatureHeader/assertFresh")(function* (this: SignatureHeader) {
    const now = yield* DateTime.now;
    if (Math.abs(now.epochMilliseconds - this.timestampSeconds * 1000) <= SIGNATURE_VALIDITY_WINDOW_MS) {
      return;
    }

    return yield* SignatureError.make({
      reason: "expired",
      message: `Signature expired: timestamp ${this.timestampSeconds} is outside the validity window`,
    });
  });
}

export class SignedPayload extends Schema.Class<SignedPayload>("effect-inngest/SignedPayload")({
  body: Schema.Uint8Array,
  signature: Schema.OptionFromUndefinedOr(SignatureHeader),
}) {
  readonly requireSignature = Effect.fn("effect-inngest/SignedPayload/requireSignature")(
    function (this: SignedPayload) {
      return Effect.fromOption(this.signature).pipe(
        Effect.mapError(() =>
          SignatureError.make({
            reason: "missing_header",
            message: "Missing Inngest signature header",
          }),
        ),
      );
    },
  );
}

interface SignatureService {
  readonly verify: (payload: SignedPayload) => Effect.Effect<void, SignatureError>;
  readonly sign: (body: Uint8Array) => Effect.Effect<string, SignatureError>;
}

const SIGNATURE_VALIDITY_WINDOW_MS = 5 * 60 * 1000;

const TimestampSeconds = Schema.NumberFromString.pipe(Schema.check(Schema.isInt(), Schema.isGreaterThan(0)));
const SignatureParams = Schema.Struct({ t: TimestampSeconds, s: Schema.Uint8ArrayFromHex });

export const hashSigningKey = (signingKey: string): string =>
  Encoding.encodeHex(
    NodeCrypto.createHash("sha256")
      .update(signingKey.replace(/^signkey-\w+-/, ""))
      .digest(),
  );

export class Signature extends Context.Service<Signature, SignatureService>()("effect-inngest/Signature", {
  make: (config: SignatureConfig) =>
    Effect.gen(function* () {
      const signingKey = config.signingKey.pipe(Option.flatMap(PreparedSigningKey.decode));
      const fallbackSigningKey = config.signingKeyFallback.pipe(Option.flatMap(PreparedSigningKey.decode));

      if (Option.isSome(config.signingKey) && Option.isNone(signingKey)) {
        return yield* SignatureError.make({ reason: "invalid_format", message: "Invalid signing key" });
      }
      if (Option.isSome(config.signingKeyFallback) && Option.isNone(fallbackSigningKey)) {
        return yield* SignatureError.make({ reason: "invalid_format", message: "Invalid signing key" });
      }

      const signingKeys = Arr.getSomes([signingKey, fallbackSigningKey]);

      const verify = Effect.fn("effect-inngest/Signature/verify")(function* (payload: SignedPayload) {
        if (config.verification === "disabled") {
          return;
        }
        if (Arr.isArrayEmpty(signingKeys)) {
          return yield* SignatureError.make({
            reason: "missing_signing_key",
            message: "No signing key configured for signature verification",
          });
        }

        const header = yield* payload.requireSignature();
        yield* header.assertFresh();

        const valid = signingKeys.some((key) => key.verifies(payload.body, header));

        if (!valid) {
          return yield* SignatureError.make({ reason: "invalid_signature", message: "Invalid signature" });
        }
      });

      const sign = Effect.fn("effect-inngest/Signature/sign")(function* (body: Uint8Array) {
        const key = yield* Option.match(signingKey, {
          onNone: () =>
            SignatureError.make({
              reason: "missing_signing_key",
              message: "No signing key configured for signing",
            }),
          onSome: Effect.succeed,
        });

        const now = yield* DateTime.now;
        const timestampSeconds = Math.floor(now.epochMilliseconds / 1000);
        return `t=${timestampSeconds}&s=${Encoding.encodeHex(key.sign(body, timestampSeconds))}`;
      });

      return { verify, sign };
    }),
}) {
  static readonly layer = (config: SignatureConfig): Layer.Layer<Signature, SignatureError> =>
    Layer.effect(this, this.make(config));
}

export const SignatureLive: Layer.Layer<Signature, SignatureError, InngestClient> = Layer.effect(
  Signature,
  Effect.gen(function* () {
    const client = yield* InngestClient;
    return yield* Signature.make(
      SignatureConfig.make({
        verification: client.mode === "dev" ? "disabled" : "required",
        signingKey: Option.fromNullishOr(client.config.signingKey),
        signingKeyFallback: Option.fromNullishOr(client.config.signingKeyFallback),
      }),
    );
  }),
);
