import { Context, Effect, Schema } from "effect";

export const StepExecution = Schema.Literals(["handler", "step"]);
export type StepExecution = typeof StepExecution.Type;

export const CurrentStepExecution = Context.Reference<StepExecution>(
  "effect-inngest/internal/runtime/CurrentStepExecution",
  { defaultValue: () => "handler" },
);

export const isHandler = Effect.map(CurrentStepExecution, (execution) => execution === "handler");

export const withinStep = <A, E, R>(effect: Effect.Effect<A, E, R>): Effect.Effect<A, E, R> =>
  Effect.provideService(effect, CurrentStepExecution, "step");
