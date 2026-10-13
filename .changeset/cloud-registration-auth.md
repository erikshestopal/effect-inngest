---
"effect-inngest": patch
---

Cloud registration now authenticates the way the native SDK does. The `PUT` register request sends `Bearer <hashed signing key>` instead of the raw key, and sends `X-Inngest-Env` when the client config has an env. `hashSigningKey` keeps the `signkey-<env>-` prefix and hashes the hex-decoded key bytes, which also corrects the checkpoint token. `InngestClient.layerFromEnv` now reads `INNGEST_ENV` and `INNGEST_DEV`, defaulting to cloud mode, as its docstring already said.
