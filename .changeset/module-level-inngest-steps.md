---
"effect-inngest": minor
---

Remove public result schemas, move durable workflow operations from handler-scoped `step.*` tools to module-level `Inngest.*` functions, and simplify function triggers to accept event definitions or `InngestCron.make(...)` directly. Step and function results are normalized through JSON wire semantics before memoization/replay.
