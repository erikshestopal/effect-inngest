import { Schema } from "effect";
import * as Protocol from "../protocol.js";

export class ExecutionResult extends Schema.Class<ExecutionResult>("ExecutionResult")({
  status: Schema.Literals([200, 206, 400, 500]),
  body: Schema.Unknown,
  headers: Schema.Record(Schema.String, Schema.String),
}) {}

export const encodeOpcodes = (opcodes: ReadonlyArray<typeof Protocol.GeneratorOpcode.Type>) =>
  Schema.encodeSync(Schema.Array(Protocol.GeneratorOpcode))(opcodes);
