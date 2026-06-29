import { BunHttpServer, BunServices } from "@effect/platform-bun";
import { Config, Effect, Layer, Schema } from "effect";
import { FetchHttpClient, HttpRouter } from "effect/unstable/http";
import { InngestClient, InngestEvent, InngestFunction, InngestGroup } from "effect-inngest";

const Start = InngestEvent.make("start", Schema.Struct({}));

const Fn = InngestFunction.make("Fn", {
  trigger: Start,
});

const Group = InngestGroup.make(Fn);

const HandlersLive = Group.toLayer({
  Fn: () => Effect.succeed({ ok: true }),
});

const InngestClientLive = InngestClient.layerConfig(
  Config.all({
    id: Config.succeed("test-app"),
    eventKey: Config.succeed("local"),
    mode: Config.succeed("dev" as const),
    signingKey: Config.succeed("local"),
    apiBaseUrl: Config.succeed("http://localhost:8288"),
    eventBaseUrl: Config.succeed("http://localhost:8288"),
    serveHost: Config.succeed("http://host.docker.internal:3000"),
  }),
).pipe(Layer.provide(FetchHttpClient.layer));

const HttpRoutes = Layer.mergeAll(HttpRouter.add("*", "*", InngestGroup.toHttpApp(Group)));

export const LaunchableHttpRouter = HttpRouter.serve(HttpRoutes).pipe(
  Layer.provide(BunHttpServer.layer({ port: 3000, hostname: "0.0.0.0" })),
  Layer.provide(HandlersLive),
  Layer.provide(InngestClientLive),
  Layer.provide(FetchHttpClient.layer),
  Layer.provide(BunServices.layer),
  Layer.launch,
);
