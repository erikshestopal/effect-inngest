import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { InngestClient, InngestEvent } from "effect-inngest";
import { defineExample, effectCase } from "./_support.ts";

const DemoSchemaClientEvent = InngestEvent.make(
  "examples/067-schema-client-send/demo/client-event",
  Schema.Struct({
    url: Schema.URL,
  }),
);

const main = Effect.gen(function* () {
  const client = yield* InngestClient.InngestClient;

  return yield* client.sendEvent([DemoSchemaClientEvent.make({ url: new URL("https://example.com/client-send") })]);
});

export default defineExample({
  id: "067-schema-client-send",
  cases: [effectCase(main, { timeoutMs: 20_000 })],
});
