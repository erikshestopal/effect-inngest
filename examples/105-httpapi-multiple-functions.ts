import { FetchHttpClient } from "@effect/platform";
import { BunHttpServer, BunRuntime } from "@effect/platform-bun";
import * as HttpMiddleware from "@effect/platform/HttpMiddleware";
import * as HttpServer from "@effect/platform/HttpServer";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import { InngestClient, InngestFunction, InngestGroup } from "effect-inngest";

class UserCreated extends Schema.TaggedClass<UserCreated>()("user/created", {
  userId: Schema.String,
  email: Schema.String,
}) {}

class UserDeleted extends Schema.TaggedClass<UserDeleted>()("user/deleted", {
  userId: Schema.String,
}) {}

const OnUserCreated = InngestFunction.make("on-user-created", {
  trigger: { event: UserCreated },
  success: Schema.Struct({ welcomed: Schema.Boolean }),
});

const OnUserDeleted = InngestFunction.make("on-user-deleted", {
  trigger: { event: UserDeleted },
  success: Schema.Struct({ cleaned: Schema.Boolean }),
});

const Group = InngestGroup.make(OnUserCreated, OnUserDeleted);

const HandlersLive = Group.toLayer({
  "on-user-created": ({ event, step }) =>
    Effect.gen(function* () {
      yield* step.run("send-welcome", Effect.log(`Sending welcome to ${event.email}`));
      return { welcomed: true };
    }),
  "on-user-deleted": ({ event, step }) =>
    Effect.gen(function* () {
      yield* step.run("cleanup", Effect.log(`Cleaning up data for ${event.userId}`));
      return { cleaned: true };
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
