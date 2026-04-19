import { FetchHttpClient } from "effect/unstable/http";
import { BunHttpServer, BunRuntime } from "@effect/platform-bun";
import * as HttpMiddleware from "effect/unstable/http/HttpMiddleware";
import * as HttpServer from "effect/unstable/http/HttpServer";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import { InngestClient, InngestFunction, InngestGroup } from "effect-inngest";

class UserCreated extends Schema.TaggedClass<UserCreated>()("user/created", {
  userId: Schema.String,
}) {}

class UserUpdated extends Schema.TaggedClass<UserUpdated>()("user/updated", {
  userId: Schema.String,
}) {}

const UserHandlerFn = InngestFunction.make("user-handler", {
  trigger: [{ event: UserCreated }, { event: UserUpdated }],
  success: Schema.Struct({ eventName: Schema.String, userId: Schema.String, action: Schema.String }),
});

const Group = InngestGroup.make(UserHandlerFn);

const HandlersLive = Group.toLayer({
  "user-handler": ({ event }) =>
    Effect.gen(function* () {
      const action = event._tag === "user/created" ? "Created" : "Updated";
      yield* Effect.log(`User ${action}: ${event.userId}`);
      return { eventName: event._tag, userId: event.userId, action };
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
