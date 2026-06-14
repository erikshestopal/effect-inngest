/**
 * Function introspection boundary.
 * @internal
 */
import * as Schema from "effect/Schema";
import * as Protocol from "../protocol.js";

export class IntrospectionSucceeded extends Schema.Class<IntrospectionSucceeded>(
  "effect-inngest/IntrospectionSucceeded",
)({
  response: Protocol.IntrospectionResponse,
}) {}
