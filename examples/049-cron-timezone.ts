import { FetchHttpClient } from "effect/unstable/http";
import { BunHttpServer, BunRuntime } from "@effect/platform-bun";
import * as HttpMiddleware from "effect/unstable/http/HttpMiddleware";
import * as HttpServer from "effect/unstable/http/HttpServer";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import { InngestClient, InngestFunction, InngestGroup } from "effect-inngest";

const CronTimezoneFn = InngestFunction.make("daily-9am-est", {
  trigger: { cron: "TZ=America/New_York 0 9 * * *" },
  success: Schema.Struct({ executedAt: Schema.String, timezone: Schema.String }),
});

const Group = InngestGroup.make(CronTimezoneFn);

const HandlersLive = Group.toLayer({
  "daily-9am-est": () =>
    Effect.gen(function* () {
      const now = new Date().toISOString();
      yield* Effect.log(`Daily 9am EST job executed at: ${now}`);
      return {
        executedAt: now,
        timezone: "America/New_York",
      };
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
