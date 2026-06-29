import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { describe, expect, it } from "@effect/vitest";
import { InngestFunction, InngestGroup, InngestEvent, Inngest } from "../../src/index.js";
import * as Protocol from "../../src/internal/protocol.js";
import { makeTestLayer, makeTestRequest } from "./_helpers.js";
import { StepOpcodeResponse } from "./_schemas.js";

const ProcessOrderResult = Schema.Struct({ orderId: Schema.String, total: Schema.Number });

const OrderPlaced = InngestEvent.make(
  "order/placed",
  Schema.Struct({
    orderId: Schema.String,
    price: Schema.Number,
    quantity: Schema.Number,
  }),
);

describe("TB-002: Step Memoization", () => {
  const ProcessOrder = InngestFunction.make("process-order", {
    trigger: OrderPlaced,
  });

  const Group = InngestGroup.make(ProcessOrder);

  const request = (steps: (typeof Protocol.SDKRequestBody.Type)["steps"] = {}) =>
    makeTestRequest({
      fnId: "process-order",
      eventName: "order/placed",
      eventData: { orderId: "order_123", price: 10, quantity: 5 },
      steps,
    });

  it.effect("returns 206 with StepPlanned on first invocation", () =>
    Effect.gen(function* () {
      const HandlersLive = Group.toLayer({
        "process-order": ({ event }) =>
          Effect.gen(function* () {
            const total = yield* Inngest.run("calculate-total", Effect.succeed(event.data.price * event.data.quantity));
            return { orderId: event.data.orderId, total };
          }),
      });

      const { handler, dispose } = InngestGroup.toWebHandler(Group, { layer: makeTestLayer(HandlersLive) });

      try {
        const response = yield* Effect.tryPromise(() => handler(request()));

        expect(response.status).toBe(206);

        const body = yield* Effect.tryPromise(() => response.json()).pipe(
          Effect.flatMap(Schema.decodeUnknownEffect(StepOpcodeResponse)),
        );

        expect(body).toHaveLength(1);
        const opcode = body[0]!;
        expect(opcode.op).toBe(Protocol.Opcode.StepPlanned);
        expect(opcode.name).toBe("calculate-total");
        expect(typeof opcode.id).toBe("string");
        expect(opcode.id.length).toBe(40);

        expect(body).toMatchInlineSnapshot(`
          [
            {
              "displayName": "calculate-total",
              "id": "3801d4a5540e7450fe1648b2a868defa6bb8001e",
              "name": "calculate-total",
              "op": "StepPlanned",
            },
          ]
        `);
      } finally {
        yield* Effect.tryPromise(() => dispose());
      }
    }),
  );

  it.effect("returns 200 with final result when step is memoized", () =>
    Effect.gen(function* () {
      const HandlersLive = Group.toLayer({
        "process-order": ({ event }) =>
          Effect.gen(function* () {
            const total = yield* Inngest.run("calculate-total", Effect.succeed(event.data.price * event.data.quantity));
            return { orderId: event.data.orderId, total };
          }),
      });

      const { handler, dispose } = InngestGroup.toWebHandler(Group, { layer: makeTestLayer(HandlersLive) });

      try {
        const stepHash = "3801d4a5540e7450fe1648b2a868defa6bb8001e";

        const response = yield* Effect.tryPromise(() =>
          handler(
            request({
              [stepHash]: { data: 50 },
            }),
          ),
        );

        expect(response.status).toBe(200);
        const result = yield* Effect.tryPromise(() => response.json()).pipe(
          Effect.flatMap(Schema.decodeUnknownEffect(ProcessOrderResult)),
        );
        expect(result).toEqual({ orderId: "order_123", total: 50 });
      } finally {
        yield* Effect.tryPromise(() => dispose());
      }
    }),
  );
});
