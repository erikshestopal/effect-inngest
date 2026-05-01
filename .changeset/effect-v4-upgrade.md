---
"effect-inngest": minor
---

Effect v4 (beta) upgrade. Migrates from Effect 3.x to 4.0.0-beta with the new `effect-smol` package layout. Adds checkpoint mode for buffered step flushing on async opcode boundaries (spec §10.2 / §10.4.1). Test runner moved from bun-test/tsdown to vitest/vite. Module shape and public API preserved; consumers still import `InngestClient`, `InngestFunction`, `InngestGroup` from the package root.

Breaking: requires `effect@^4.0.0-beta` peer. Pre-1.0 convention treats this as a minor bump.
