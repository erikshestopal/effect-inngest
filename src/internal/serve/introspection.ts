/**
 * Function introspection boundary.
 * @internal
 */
import { Schema } from "effect";
import * as Protocol from "../protocol.js";

export class IntrospectionSucceeded extends Schema.Class<IntrospectionSucceeded>(
  "effect-inngest/IntrospectionSucceeded",
)({
  response: Protocol.IntrospectionResponse,
}) {}
