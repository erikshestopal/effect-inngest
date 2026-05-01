import { FetchHttpClient } from "effect/unstable/http";
import { BunHttpServer, BunRuntime } from "@effect/platform-bun";
import * as HttpMiddleware from "effect/unstable/http/HttpMiddleware";
import * as HttpServer from "effect/unstable/http/HttpServer";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { InngestClient, InngestFunction, InngestGroup } from "effect-inngest";

class DemoWaitStart extends Schema.TaggedClass<DemoWaitStart>()("demo/wait-start", {
  orderId: Schema.String,
}) {}

class DemoWaitComplete extends Schema.TaggedClass<DemoWaitComplete>()("demo/wait-complete", {
  orderId: Schema.String,
  status: Schema.String,
}) {}

const WaitForEventFn = InngestFunction.make("wait-for-event", {
  trigger: { event: DemoWaitStart },
  success: Schema.Struct({ receivedStatus: Schema.NullOr(Schema.String) }),
});

const Group = InngestGroup.make(WaitForEventFn);

const HandlersLive = Group.toLayer({
  "wait-for-event": ({ event, step }) =>
    Effect.gen(function* () {
      const eventOption = yield* step.waitForEvent("wait-for-complete", DemoWaitComplete, {
        timeout: Duration.minutes(5),
        if: `async.data.orderId == "${event.orderId}"`,
      });
      return { receivedStatus: Option.isSome(eventOption) ? eventOption.value.status : null };
    }),
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
