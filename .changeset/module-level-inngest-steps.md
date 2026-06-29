---
"effect-inngest": major
---

Remove public result schemas and move durable workflow operations from handler-scoped `step.*` tools to module-level `Inngest.*` functions. Step and function results are normalized through JSON wire semantics before memoization/replay.
