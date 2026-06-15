import { Context, Option } from "effect";
import type { CheckpointState } from "../../../internal/checkpoint.js";

export const CurrentCheckpoint = Context.Reference<Option.Option<CheckpointState>>(
  "effect-inngest/internal/runtime/CurrentCheckpoint",
  { defaultValue: Option.none },
);
