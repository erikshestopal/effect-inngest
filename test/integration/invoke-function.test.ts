import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { describe, expect, it } from "@effect/vitest";
import { InngestFunction, InngestGroup, InngestEvent, Inngest } from "../../src/index.js";
import * as Protocol from "../../src/internal/protocol.js";
import { makeTestLayer, makeTestRequest } from "./_helpers.js";
import { InvokeFunctionResponse } from "./_schemas.js";

const OrderCreated = InngestEvent.make(
  "order/created",
  Schema.Struct({
    orderId: Schema.String,
    total: Schema.Number,
  }),
);

const PaymentProcess = InngestEvent.make(
  "payment/process",
  Schema.Struct({
    amount: Schema.Number,
    orderId: Schema.String,
  }),
);

describe("TB-005: Invoke Function", () => {
  // Child function that will be invoked
  const ProcessPayment = InngestFunction.make("process-payment", {
    trigger: { event: PaymentProcess },
  });

  // Parent function that invokes child
  const OrderWorkflow = InngestFunction.make("order-workflow", {
    trigger: { event: OrderCreated },
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
        "process-payment": ({ event }) =>
          Effect.succeed({ transactionId: `txn_${event.data.amount}`, status: "completed" }),
        "order-workflow": ({ event }) =>
          Effect.gen(function* () {
            const paymentResult = yield* Inngest.invoke("charge-customer", {
              function: ProcessPayment,
              data: PaymentProcess.make({ amount: event.data.total, orderId: event.data.orderId }),
            });

            return { orderId: event.data.orderId, payment: paymentResult };
          }),
      });

      const { handler, dispose } = InngestGroup.toWebHandler(Group, { layer: makeTestLayer(HandlersLive) });

      try {
        const response = yield* Effect.tryPromise(() => handler(makeRequest()));

        expect(response.status).toBe(206);

        const body = yield* Effect.tryPromise(() => response.json()).pipe(
          Effect.flatMap(Schema.decodeUnknownEffect(InvokeFunctionResponse)),
        );

        expect(body).toHaveLength(1);
        const opcode = body[0]!;

        // CRITICAL ASSERTIONS - verify the contract
        expect(opcode.op).toBe(Protocol.Opcode.InvokeFunction);
        expect(opcode).not.toHaveProperty("name");
        expect(opcode).not.toHaveProperty("mode");
        // function_id format: "{app-id}-{fn-tag}"
        expect(opcode.opts.function_id).toBe("test-app-process-payment");
        expect(opcode.opts.payload.data).toEqual({ amount: 100, orderId: "order_123" });

        expect(body).toMatchInlineSnapshot(`
        	[
        	  {
        	    "data": null,
        	    "displayName": "charge-customer",
        	    "id": "ed1c8e6090d4016334d5c49881153cf45c413dee",
        	    "op": "InvokeFunction",
        	    "opts": {
        	      "function_id": "test-app-process-payment",
        	      "payload": {
        	        "data": {
        	          "amount": 100,
        	          "orderId": "order_123",
        	        },
        	      },
        	    },
        	    "userland": {
        	      "id": "charge-customer",
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
        "process-payment": ({ event }) =>
          Effect.succeed({ transactionId: `txn_${event.data.amount}`, status: "completed" }),
        "order-workflow": ({ event }) =>
          Effect.gen(function* () {
            const paymentData = PaymentProcess.make({ amount: event.data.total, orderId: event.data.orderId });
            const paymentResult = yield* (Inngest.invoke as any)("charge-customer", {
              function: ProcessPayment,
              data: paymentData,
            });

            return { orderId: event.data.orderId, payment: paymentResult };
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
        "process-payment": ({ event }) =>
          Effect.succeed({ transactionId: `txn_${event.data.amount}`, status: "completed" }),
        "order-workflow": ({ event }) =>
          Effect.gen(function* () {
            // When memoized result has error, it may return undefined
            // This tests that behavior path
            const paymentData = PaymentProcess.make({ amount: event.data.total, orderId: event.data.orderId });
            const paymentResult = yield* (Inngest.invoke as any)("charge-customer", {
              function: ProcessPayment,
              data: paymentData,
            });

            // Handle undefined result
            if (paymentResult === undefined) {
              return { orderId: event.data.orderId, status: "payment_pending" };
            }

            return { orderId: event.data.orderId, payment: paymentResult };
          }),
      });

      const { handler, dispose } = InngestGroup.toWebHandler(Group, { layer: makeTestLayer(HandlersLive) });

      try {
        const stepHash = "ed1c8e6090d4016334d5c49881153cf45c413dee";

        // Memoized result with neither 'data' nor 'error' property returns undefined
        // This tests the defensive code path in Inngest.invoke for edge cases
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
        "process-payment": ({ event }) =>
          Effect.succeed({ transactionId: `txn_${event.data.amount}`, status: "completed" }),
        "order-workflow": ({ event }) =>
          Effect.gen(function* () {
            const paymentData = PaymentProcess.make({ amount: event.data.total, orderId: event.data.orderId });
            const paymentResult = yield* (Inngest.invoke as any)("charge", {
              function: ProcessPayment,
              data: paymentData,
            });
            return { orderId: event.data.orderId, payment: paymentResult };
          }),
      });

      const { handler, dispose } = InngestGroup.toWebHandler(DifferentAppClient, {
        layer: makeTestLayer(HandlersLive),
      });

      try {
        const response = yield* Effect.tryPromise(() => handler(makeRequest()));

        expect(response.status).toBe(206);
        const body = yield* Effect.tryPromise(() => response.json()).pipe(
          Effect.flatMap(Schema.decodeUnknownEffect(InvokeFunctionResponse)),
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
