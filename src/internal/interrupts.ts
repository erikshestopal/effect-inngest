import { Schema } from "effect";
import * as Protocol from "./protocol.js";

export class StepInterrupt extends Schema.TaggedClass<StepInterrupt>()("StepInterrupt", {
  opcode: Protocol.GeneratorOpcode,
  retryAfterMs: Schema.optional(Schema.Number),
}) {}
