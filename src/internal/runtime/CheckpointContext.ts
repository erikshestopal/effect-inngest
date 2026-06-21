import { Context, Option } from "effect";
import type { CheckpointState } from "../checkpoint.js";

export const CurrentCheckpoint = Context.Reference<Option.Option<CheckpointState>>(
  "effect-inngest/internal/runtime/CurrentCheckpoint",
  { defaultValue: Option.none },
);
