import { FetchHttpClient } from "effect/unstable/http";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { InngestClient } from "effect-inngest";

const ClientLive = InngestClient.layer({
  id: "demo-client-send",
  eventKey: "test",
  apiBaseUrl: "http://127.0.0.1:8288",
}).pipe(Layer.provide(FetchHttpClient.layer));

const sendSingleEvent = Effect.gen(function* () {
  const client = yield* InngestClient.InngestClient;

  const response = yield* client.sendEvent([
    { name: "user/created", data: { userId: "123", email: "alice@example.com" } },
  ]);

  yield* Effect.log(`Sent single event, ids: ${response.ids.join(", ")}`);
  return response;
});

const sendBatchEvents = Effect.gen(function* () {
  const client = yield* InngestClient.InngestClient;

  const response = yield* client.sendEvent([
    { name: "order/placed", data: { orderId: "o1", userId: "123", total: 99.99 } },
    { name: "order/placed", data: { orderId: "o2", userId: "456", total: 149.99 } },
    { name: "notification/send", data: { channel: "email", userId: "123", template: "order-confirmation" } },
  ]);

  yield* Effect.log(`Sent batch of ${response.ids.length} events`);
  return response;
});

const sendWithDeduplicationId = Effect.gen(function* () {
  const client = yield* InngestClient.InngestClient;

  const response = yield* client.sendEvent([
    {
      name: "payment/received",
      data: { orderId: "o1", amount: 99.99 },
      id: "payment-o1-20240115",
    },
  ]);

  yield* Effect.log(`Sent event with dedup id, response: ${response.ids.join(", ")}`);
  return response;
});

const main = Effect.gen(function* () {
  yield* Effect.log("=== Client Send Events Demo ===");

  yield* sendSingleEvent;
  yield* sendBatchEvents;
  yield* sendWithDeduplicationId;

  yield* Effect.log("=== All events sent ===");
}).pipe(Effect.provide(ClientLive));

void Effect.runPromise(main);
