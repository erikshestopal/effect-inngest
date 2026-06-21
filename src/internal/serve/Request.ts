/**
 * Inbound SDK request verification and decoding boundary.
 * @internal
 */
import * as Headers from "effect/unstable/http/Headers";
import * as HttpServerRequest from "effect/unstable/http/HttpServerRequest";
import { Effect, Function, Option, Schema } from "effect";
import * as Protocol from "../protocol.js";
import { Signature, SignatureError, SignatureHeader, SignedPayload } from "./Signature.js";
export { SignatureError } from "./Signature.js";

export const bodyUint8Array = Effect.fn("effect-inngest/serve/request/bodyUint8Array")(function* (
  request: HttpServerRequest.HttpServerRequest,
) {
  return yield* request.arrayBuffer.pipe(Effect.map((buffer) => new Uint8Array(buffer)));
});

export const verifySignature: {
  (request: HttpServerRequest.HttpServerRequest): (body: Uint8Array) => Effect.Effect<void, SignatureError, Signature>;
  (body: Uint8Array, request: HttpServerRequest.HttpServerRequest): Effect.Effect<void, SignatureError, Signature>;
} = Function.dual(2, (body: Uint8Array, request: HttpServerRequest.HttpServerRequest) =>
  Effect.gen(function* () {
    const sig = yield* Signature;
    const signature = yield* Option.match(Headers.get(request.headers, Protocol.Headers.Signature), {
      onNone: () => Effect.succeed(Option.none<SignatureHeader>()),
      onSome: (header) => SignatureHeader.decode(header).pipe(Effect.map(Option.some)),
    });

    yield* sig.verify(SignedPayload.make({ body, signature }));
  }),
);

export const schemaBodyJson =
  <S extends Schema.Top>(schema: S) =>
  (body: Uint8Array): Effect.Effect<S["Type"], Schema.SchemaError, S["DecodingServices"]> => {
    const bodyText = new TextDecoder().decode(body);
    return Schema.decodeUnknownEffect(Schema.fromJsonString(schema))(bodyText);
  };
