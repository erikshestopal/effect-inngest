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

class DemoWaitMatch extends Schema.TaggedClass<DemoWaitMatch>()("demo/wait-match", {
  invoiceId: Schema.String,
}) {}

class DemoInvoicePaid extends Schema.TaggedClass<DemoInvoicePaid>()("demo/invoice-paid", {
  invoiceId: Schema.String,
  amount: Schema.Number,
}) {}

const WaitMatchFn = InngestFunction.make("wait-for-invoice-payment", {
  trigger: { event: DemoWaitMatch },
  success: Schema.Struct({ invoiceId: Schema.String, amount: Schema.NullOr(Schema.Number) }),
});

const Group = InngestGroup.make(WaitMatchFn);

const HandlersLive = Group.toLayer({
  "wait-for-invoice-payment": ({ event, step }) =>
    Effect.gen(function* () {
      yield* Effect.log(`Waiting for payment on invoice: ${event.invoiceId}`);

      const paidEvent = yield* step.waitForEvent("wait-for-payment", DemoInvoicePaid, {
        timeout: Duration.seconds(30),
        if: `async.data.invoiceId == "${event.invoiceId}"`,
      });

      if (Option.isSome(paidEvent)) {
        yield* Effect.log(`Invoice ${event.invoiceId} paid! Amount: ${paidEvent.value.amount}`);
        return { invoiceId: event.invoiceId, amount: paidEvent.value.amount };
      }

      yield* Effect.log(`Payment timeout for invoice: ${event.invoiceId}`);
      return { invoiceId: event.invoiceId, amount: null };
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
