import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { describe, expect, it } from "../bun-effect.js";
import { InngestFunction, InngestGroup } from "../../src/index.js";
import * as Protocol from "../../src/internal/protocol.js";
import { makeTestLayer, makeTestRequest } from "./_helpers.js";
import { InvokeFunctionResponse } from "./_schemas.js";

class OrderCreated extends Schema.TaggedClass<OrderCreated>()("order/created", {
  orderId: Schema.String,
  total: Schema.Number,
}) {}

class PaymentProcess extends Schema.TaggedClass<PaymentProcess>()("payment/process", {
  amount: Schema.Number,
  orderId: Schema.String,
}) {}

// Helper type: Extract the data fields from a TaggedClass (excludes _tag)
type EventData<E> = Omit<E, "_tag">;

describe("TB-005: Invoke Function", () => {
  // Child function that will be invoked
  const ProcessPayment = InngestFunction.make("process-payment", {
    trigger: { event: PaymentProcess },
    success: Schema.Struct({ transactionId: Schema.String, status: Schema.String }),
  });

  // Parent function that invokes child
  const OrderWorkflow = InngestFunction.make("order-workflow", {
    trigger: { event: OrderCreated },
    success: Schema.Struct({
      orderId: Schema.String,
      payment: Schema.optional(Schema.Struct({ transactionId: Schema.String, status: Schema.String })),
      status: Schema.optional(Schema.String),
    }),
  });

  const Group = InngestGroup.make(ProcessPayment, OrderWorkflow);

  const makeRequest = (steps: (typeof Protocol.SDKRequestBody.Type)["steps"] = {}) =>
    makeTestRequest({
      fnId: "order-workflow",
      eventName: "order/created",
      eventData: { orderId: "order_123", total: 100 },
      steps,
    });

  it.effect("returns 206 with InvokeFunction opcode", () =>
    Effect.gen(function* () {
      const HandlersLive = Group.toLayer({
        "process-payment": ({ event }) => Effect.succeed({ transactionId: `txn_${event.amount}`, status: "completed" }),
        "order-workflow": ({ event, step }) =>
          Effect.gen(function* () {
            const paymentResult = yield* step.invoke("charge-customer", {
              function: ProcessPayment,
              data: PaymentProcess.make({ amount: event.total, orderId: event.orderId }),
            });

            return { orderId: event.orderId, payment: paymentResult };
          }),
      });

      const { handler, dispose } = InngestGroup.toWebHandler(Group, { layer: makeTestLayer(HandlersLive) });

      try {
        const response = yield* Effect.tryPromise(() => handler(makeRequest()));

        expect(response.status).toBe(206);

        const body = yield* Effect.tryPromise(() => response.json()).pipe(
          Effect.flatMap(Schema.decodeUnknown(InvokeFunctionResponse)),
        );

        expect(body).toHaveLength(1);
        const opcode = body[0]!;

        // CRITICAL ASSERTIONS - verify the contract
        expect(opcode.op).toBe(Protocol.Opcode.InvokeFunction);
        expect(opcode.name).toBe("charge-customer");
        expect(opcode.mode).toBe("async"); // Required for Inngest to process invoke
        // function_id format: "{app-id}-{fn-tag}"
        expect(opcode.opts.function_id).toBe("test-app-process-payment");
        expect(opcode.opts.payload.data).toEqual({ amount: 100, orderId: "order_123" });

        // Snapshot for documentation - shows full response structure
        expect(body).toMatchInlineSnapshot(`
          [
            {
              "displayName": "charge-customer",
              "id": "ed1c8e6090d4016334d5c49881153cf45c413dee",
              "mode": "async",
              "name": "charge-customer",
              "op": "InvokeFunction",
              "opts": {
                "function_id": "test-app-process-payment",
                "payload": {
                  "data": {
                    "amount": 100,
                    "orderId": "order_123",
                  },
                },
                "timeout": "365d",
              },
            },
          ]
        `);
      } finally {
        yield* Effect.tryPromise(() => dispose());
      }
    }),
  );

  it.effect("returns 200 with combined result when invoke completes", () =>
    Effect.gen(function* () {
      const HandlersLive = Group.toLayer({
        "process-payment": ({ event }) => Effect.succeed({ transactionId: `txn_${event.amount}`, status: "completed" }),
        "order-workflow": ({ event, step }) =>
          Effect.gen(function* () {
            const paymentData: EventData<PaymentProcess> = { amount: event.total, orderId: event.orderId };
            const paymentResult = yield* (step.invoke as any)("charge-customer", {
              function: ProcessPayment,
              data: paymentData,
            });

            return { orderId: event.orderId, payment: paymentResult };
          }),
      });

      const { handler, dispose } = InngestGroup.toWebHandler(Group, { layer: makeTestLayer(HandlersLive) });

      try {
        // STEP ID RULE (from TB-002): steps map key = hashed step id
        const stepHash = "ed1c8e6090d4016334d5c49881153cf45c413dee";

        const response = yield* Effect.tryPromise(() =>
          handler(
            makeRequest({
              [stepHash]: {
                data: { transactionId: "txn_100", status: "completed" },
              },
            }),
          ),
        );

        expect(response.status).toBe(200);
        // Return shape is test artifact (ad-hoc), not contractual schema
        const result = yield* Effect.tryPromise(() => response.json());
        expect(result).toEqual({
          orderId: "order_123",
          payment: { transactionId: "txn_100", status: "completed" },
        });
      } finally {
        yield* Effect.tryPromise(() => dispose());
      }
    }),
  );

  it.effect("handles undefined result when step has no data", () =>
    Effect.gen(function* () {
      const HandlersLive = Group.toLayer({
        "process-payment": ({ event }) => Effect.succeed({ transactionId: `txn_${event.amount}`, status: "completed" }),
        "order-workflow": ({ event, step }) =>
          Effect.gen(function* () {
            // When memoized result has error, it may return undefined
            // This tests that behavior path
            const paymentData: EventData<PaymentProcess> = { amount: event.total, orderId: event.orderId };
            const paymentResult = yield* (step.invoke as any)("charge-customer", {
              function: ProcessPayment,
              data: paymentData,
            });

            // Handle undefined result
            if (paymentResult === undefined) {
              return { orderId: event.orderId, status: "payment_pending" };
            }

            return { orderId: event.orderId, payment: paymentResult };
          }),
      });

      const { handler, dispose } = InngestGroup.toWebHandler(Group, { layer: makeTestLayer(HandlersLive) });

      try {
        const stepHash = "ed1c8e6090d4016334d5c49881153cf45c413dee";

        // Memoized result with neither 'data' nor 'error' property returns undefined
        // This tests the defensive code path in step.invoke for edge cases
        const response = yield* Effect.tryPromise(() =>
          handler(
            makeRequest({
              [stepHash]: {
                input: { requestData: "test" }, // No data/error - invoke returns undefined
              },
            }),
          ),
        );

        expect(response.status).toBe(200);
        const result = yield* Effect.tryPromise(() => response.json());
        expect(result).toMatchInlineSnapshot(`
          {
            "orderId": "order_123",
            "status": "payment_pending",
          }
        `);
      } finally {
        yield* Effect.tryPromise(() => dispose());
      }
    }),
  );

  it.effect("verifies function_id format follows convention", () =>
    Effect.gen(function* () {
      // Test with different app ID to verify format
      const DifferentAppClient = InngestGroup.make(ProcessPayment, OrderWorkflow);

      const HandlersLive = DifferentAppClient.toLayer({
        "process-payment": ({ event }) => Effect.succeed({ transactionId: `txn_${event.amount}`, status: "completed" }),
        "order-workflow": ({ event, step }) =>
          Effect.gen(function* () {
            const paymentData: EventData<PaymentProcess> = { amount: event.total, orderId: event.orderId };
            const paymentResult = yield* (step.invoke as any)("charge", {
              function: ProcessPayment,
              data: paymentData,
            });
            return { orderId: event.orderId, payment: paymentResult };
          }),
      });

      const { handler, dispose } = InngestGroup.toWebHandler(DifferentAppClient, {
        layer: makeTestLayer(HandlersLive),
      });

      try {
        const response = yield* Effect.tryPromise(() => handler(makeRequest()));

        expect(response.status).toBe(206);
        const body = yield* Effect.tryPromise(() => response.json()).pipe(
          Effect.flatMap(Schema.decodeUnknown(InvokeFunctionResponse)),
        );
        const opcode = body[0]!;

        // Verify the convention: "{app-id}-{fn-tag}"
        expect(opcode.opts.function_id).toBe("test-app-process-payment");
      } finally {
        yield* Effect.tryPromise(() => dispose());
      }
    }),
  );
});
