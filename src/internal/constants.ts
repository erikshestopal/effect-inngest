export const OtelAttributes = {
  RunId: "inngest.run_id",
  FunctionId: "inngest.function_id",
  AppId: "inngest.app_id",
  Attempt: "inngest.attempt",
  StepId: "inngest.step.id",
  StepType: "inngest.step.type",
  ExceptionType: "exception.type",
  ExceptionMessage: "exception.message",
  ExceptionStacktrace: "exception.stacktrace",
} as const;
