/**
 * Function registration / sync boundary.
 * @internal
 */
import * as Schema from "effect/Schema";
import * as Protocol from "../protocol.js";

export class RegistrationFailed extends Schema.TaggedErrorClass<RegistrationFailed>()("RegistrationFailed", {
  message: Schema.String,
}) {}

export class RegistrationSucceeded extends Schema.Class<RegistrationSucceeded>("effect-inngest/RegistrationSucceeded")({
  response: Protocol.RegisterResponse,
}) {}
