import * as Memo from "../../domain/Memo.js";
import type { ExecutionInput } from "../../domain/ExecutionInput.js";
import type { StepInfo } from "../../domain/StepInfo.js";

export const memoFor = (args: { readonly input: ExecutionInput; readonly info: StepInfo }): Memo.Memo =>
  Memo.decode(args.input.steps[args.info.hash]);

export const shouldPlan = (args: { readonly input: ExecutionInput; readonly info: StepInfo }): boolean =>
  args.input.disableImmediateExecution || (args.input.stepId !== "step" && args.input.stepId !== args.info.hash);
