import { FetchHttpClient } from "@effect/platform";
import { BunHttpServer, BunRuntime } from "@effect/platform-bun";
import * as HttpMiddleware from "@effect/platform/HttpMiddleware";
import * as HttpServer from "@effect/platform/HttpServer";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import { InngestClient, InngestFunction, InngestGroup } from "effect-inngest";

class EmailService extends Context.Tag("EmailService")<
  EmailService,
  {
    readonly send: (to: string, subject: string, body: string) => Effect.Effect<void>;
  }
>() {}

const EmailServiceLive = Layer.succeed(EmailService, {
  send: (to, subject, body) =>
    Effect.sync(() => {
      console.log(`[EMAIL] To: ${to}, Subject: ${subject}, Body: ${body}`);
    }),
});

class DemoWithServices extends Schema.TaggedClass<DemoWithServices>()("demo/with-services", {
  name: Schema.String,
}) {}

const ServiceFn = InngestFunction.make("service-handler", {
  trigger: { event: DemoWithServices },
  success: Schema.Struct({ sent: Schema.Boolean }),
});

const Group = InngestGroup.make(ServiceFn);

const HandlersLive = Group.toLayer({
  "service-handler": ({ event }) =>
    Effect.gen(function* () {
      const email = yield* EmailService;
      yield* email.send("user@example.com", "Welcome!", `Hello ${event.name}, welcome to our service!`);
      return { sent: true };
    }),
}).pipe(Layer.provide(EmailServiceLive));

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
