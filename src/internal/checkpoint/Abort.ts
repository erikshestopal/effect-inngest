import { Schema } from "effect";

export class StaleDispatch extends Schema.TaggedClass<StaleDispatch>()("StaleDispatch", {}) {}

export type CheckpointAbort = StaleDispatch;
