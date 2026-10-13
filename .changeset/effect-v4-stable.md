---
"effect-inngest": minor
---

Effect 4.0.0 stable. The `effect` peer moves from `>=4.0.0-beta.83` to `^4.0.0`, and the `effect`, `@effect/platform-bun` and `@effect/vitest` dev dependencies move to `4.0.0`. Source follows the beta-to-stable renames: `effect/unstable/http*` to `effect/http*`, `Schema.TaggedErrorClass` to `Schema.TaggedError`, `Schedule.both` to `Schedule.max`, `Config.string` to `Config.String`, `HttpApiGroup.Any`/`ApiGroup` to `Constraint`/`Service`, `Headers.HeadersSchema` to `Schema.Headers`, `UrlParams.schemaRecord` to `Schema.RecordFromUrlParams`, `Encoding.encodeHex` to `Hex.encode`, and `Schema.DateValid` to `Schema.Date`.

Breaking: requires `effect@^4.0.0`. Beta peers no longer satisfy the range.
