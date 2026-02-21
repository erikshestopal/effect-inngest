---
"effect-inngest": patch
---

Fix recursive stripTags destroying nested \_tag required for Schema.Union discrimination. Encode event data via Schema.encode before wire transmission in step.invoke and step.sendEvent.
