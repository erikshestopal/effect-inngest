# Spec Matrix

This directory is the first-pass non-advanced Inngest SDK compliance matrix for `effect-inngest`.

The source of truth is `test/spec/matrix.ts`.

## Scope

Included here:

- HTTP and headers
- env/config behavior
- sync/registration
- call handling
- `ctx.use_api`
- introspection
- durable step types implemented by this SDK
- registration serialization for supported function options

Explicitly excluded here:

- middleware
- connect
- streaming
- checkpointing
- AI gateway
- gateway HTTP fetch

## Status meanings

- `covered`: current tests are strong enough to count as compliance evidence
- `partial`: there is some evidence, but it is not exact enough or it only covers part of the clause
- `missing`: no meaningful evidence yet
- `failing`: current implementation appears to violate the spec

## Evidence quality

- `strict`: exact contract assertions exist
- `partial`: adjacent coverage exists but not the full contract
- `weak`: schema or smoke coverage only

## How to use it

1. Add or tighten tests until every in-scope `MUST` is `covered`.
2. Keep `missingCases` empty for any clause you want to call complete.
3. Treat `failing` clauses as implementation backlog, not test backlog.
4. Prefer exact assertions over permissive ones like `[400, 500]`.
