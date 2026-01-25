import { FetchHttpClient } from "@effect/platform";
import { BunHttpServer, BunRuntime } from "@effect/platform-bun";
import * as HttpMiddleware from "@effect/platform/HttpMiddleware";
import * as HttpServer from "@effect/platform/HttpServer";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import { InngestClient, InngestFunction, InngestGroup } from "effect-inngest";

class DemoIdempotent extends Schema.TaggedClass<DemoIdempotent>()("demo/idempotent", {
  cartId: Schema.String,
}) {}

const IdempotentFn = InngestFunction.make("checkout-handler", {
  trigger: { event: DemoIdempotent },
  idempotency: "event.data.cartId",
  success: Schema.Struct({ checkoutId: Schema.String }),
});

const Group = InngestGroup.make(IdempotentFn);

const HandlersLive = Group.toLayer({
  "checkout-handler": ({ event }) => Effect.succeed({ checkoutId: `checkout-for-${event.cartId}` }),
});

const ClientLive = InngestClient.layer({
  id: "research-app",
  mode: "dev",
  apiBaseUrl: "http://127.0.0.1:8288",
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
