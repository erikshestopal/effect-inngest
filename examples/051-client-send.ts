import * as Effect from "effect/Effect";
import { InngestClient } from "effect-inngest";
import { defineExample, effectCase } from "./_support.ts";

const sendSingleEvent = Effect.gen(function* () {
  const client = yield* InngestClient.InngestClient;

  const response = yield* client.sendEvent([
    { name: "examples/051-client-send/user/created", data: { userId: "123", email: "alice@example.com" } },
  ]);

  yield* Effect.log(`Sent single event, ids: ${response.ids.join(", ")}`);
  return response;
});

const sendBatchEvents = Effect.gen(function* () {
  const client = yield* InngestClient.InngestClient;

  const response = yield* client.sendEvent([
    { name: "examples/051-client-send/order/placed", data: { orderId: "o1", userId: "123", total: 99.99 } },
    { name: "examples/051-client-send/order/placed", data: { orderId: "o2", userId: "456", total: 149.99 } },
    {
      name: "examples/051-client-send/notification/send",
      data: { channel: "email", userId: "123", template: "order-confirmation" },
    },
  ]);

  yield* Effect.log(`Sent batch of ${response.ids.length} events`);
  return response;
});

const sendWithDeduplicationId = Effect.gen(function* () {
  const client = yield* InngestClient.InngestClient;

  const response = yield* client.sendEvent([
    {
      name: "examples/051-client-send/payment/received",
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
});

export default defineExample({
  id: "051-client-send",
  cases: [effectCase(main, { timeoutMs: 20_000 })],
});
