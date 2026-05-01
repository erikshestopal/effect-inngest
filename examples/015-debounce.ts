import { FetchHttpClient } from "effect/unstable/http";
import { BunHttpServer, BunRuntime } from "@effect/platform-bun";
import * as HttpMiddleware from "effect/unstable/http/HttpMiddleware";
import * as HttpServer from "effect/unstable/http/HttpServer";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import { InngestClient, InngestFunction, InngestGroup } from "effect-inngest";

class DemoDebounced extends Schema.TaggedClass<DemoDebounced>()("demo/debounced", {
  seq: Schema.Number,
}) {}

const DebouncedFn = InngestFunction.make("debounced-fn", {
  trigger: { event: DemoDebounced },
  success: Schema.Struct({ seq: Schema.Number, processedAt: Schema.String }),
  debounce: { period: "1 second" },
});

const Group = InngestGroup.make(DebouncedFn);

const HandlersLive = Group.toLayer({
  "debounced-fn": ({ event }) =>
    Effect.gen(function* () {
      yield* Effect.log(`Processing debounced event with seq: ${event.seq}`);
      return { seq: event.seq, processedAt: new Date().toISOString() };
    }),
});

const ClientLive = InngestClient.layer({
  id: "research-app",
  mode: "dev",
  apiBaseUrl: "http://127.0.0.1:8288",
  eventBaseUrl: "http://127.0.0.1:8288",
}).pipe(Layer.provide(FetchHttpClient.layer));

HttpServer.serve(InngestGroup.toHttpApp(Group), HttpMiddleware.logger).pipe(
  HttpServer.withLogAddress,
  Layer.provide(BunHttpServer.layer({ port: 9999, hostname: "0.0.0.0" })),
  Layer.provide(HandlersLive),
  Layer.provide(ClientLive),
  Layer.provide(FetchHttpClient.layer),
  Layer.launch,
  BunRuntime.runMain,
);
