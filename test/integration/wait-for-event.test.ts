import * as Effect from "effect/Effect";
import * as Duration from "effect/Duration";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { describe, expect, it } from "@effect/vitest";
import { InngestFunction, InngestGroup } from "../../src/index.js";
import * as Protocol from "../../src/internal/protocol.js";
import { makeTestLayer, makeTestRequest } from "./_helpers.js";
import { WaitForEventOpcodeResponse } from "./_schemas.js";

class OrderPending extends Schema.TaggedClass<OrderPending>()("order/pending", {
  orderId: Schema.String,
}) {}

class OrderApproved extends Schema.TaggedClass<OrderApproved>()("order/approved", {
  orderId: Schema.String,
  approvedBy: Schema.String,
}) {}

describe("TB-004: Wait For Event", () => {
  const ApprovalFlow = InngestFunction.make("approval-flow", {
    trigger: { event: OrderPending },
    success: Schema.Union([
      Schema.Struct({ status: Schema.Literal("timeout"), orderId: Schema.String }),
      Schema.Struct({ status: Schema.Literal("approved"), approvedBy: Schema.String }),
    ]),
  });

  const Group = InngestGroup.make(ApprovalFlow);

  const request = (steps: (typeof Protocol.SDKRequestBody.Type)["steps"] = {}) =>
    makeTestRequest({
      fnId: "approval-flow",
      eventName: "order/pending",
      eventData: { orderId: "order_123" },
      steps,
    });

  it.effect("returns 206 with WaitForEvent opcode on first invocation", () =>
    Effect.gen(function* () {
      const HandlersLive = Group.toLayer({
        "approval-flow": ({ event, step }) =>
          Effect.gen(function* () {
            const approval = yield* step.waitForEvent("wait-approval", OrderApproved, {
              timeout: Duration.hours(24),
              if: `async.data.orderId == "${event.orderId}"`,
            });

            if (Option.isNone(approval)) {
              return { status: "timeout" as const, orderId: event.orderId };
            }
            return { status: "approved" as const, approvedBy: approval.value.approvedBy };
          }),
      });

      const { handler, dispose } = InngestGroup.toWebHandler(Group, { layer: makeTestLayer(HandlersLive) });

      try {
        const response = yield* Effect.tryPromise(() => handler(request()));

        expect(response.status).toBe(206);

        const body = yield* Effect.tryPromise(() => response.json()).pipe(
          Effect.flatMap(Schema.decodeUnknownEffect(WaitForEventOpcodeResponse)),
        );

        expect(body).toHaveLength(1);
        const opcode = body[0]!;
        expect(opcode.op).toBe(Protocol.Opcode.WaitForEvent);
        expect(opcode.name).toBe("wait-approval");
        expect(opcode.opts.event).toBe("order/approved");
        expect(opcode.opts.timeout).toBe("1d");
        expect(typeof opcode.id).toBe("string");
        expect(opcode.id.length).toBe(40);

        expect(body).toMatchInlineSnapshot(`
          [
            {
              "displayName": "wait-approval",
              "id": "df213fbba68cded20d69d058d0047d7233586642",
              "name": "wait-approval",
              "op": "WaitForEvent",
              "opts": {
                "event": "order/approved",
                "if": "async.data.orderId == "order_123"",
                "timeout": "1d",
              },
            },
          ]
        `);
      } finally {
        yield* Effect.tryPromise(() => dispose());
      }
    }),
  );

  it.effect("returns approved result when event received", () =>
    Effect.gen(function* () {
      const HandlersLive = Group.toLayer({
        "approval-flow": ({ event, step }) =>
          Effect.gen(function* () {
            const approval = yield* step.waitForEvent("wait-approval", OrderApproved, {
              timeout: Duration.hours(24),
              if: `async.data.orderId == "${event.orderId}"`,
            });

            if (Option.isNone(approval)) {
              return { status: "timeout" as const, orderId: event.orderId };
            }
            return { status: "approved" as const, approvedBy: approval.value.approvedBy };
          }),
      });

      const { handler, dispose } = InngestGroup.toWebHandler(Group, { layer: makeTestLayer(HandlersLive) });

      try {
        const stepHash = "df213fbba68cded20d69d058d0047d7233586642";

        const response = yield* Effect.tryPromise(() =>
          handler(
            request({
              [stepHash]: {
                data: {
                  name: "order/approved",
                  data: { orderId: "order_123", approvedBy: "admin@example.com" },
                  id: "evt_2",
                  ts: Date.now(),
                },
              },
            }),
          ),
        );

        expect(response.status).toBe(200);
        expect(yield* Effect.tryPromise(() => response.json())).toEqual({
          status: "approved",
          approvedBy: "admin@example.com",
        });
      } finally {
        yield* Effect.tryPromise(() => dispose());
      }
    }),
  );

  it.effect("returns timeout result when null received", () =>
    Effect.gen(function* () {
      const HandlersLive = Group.toLayer({
        "approval-flow": ({ event, step }) =>
          Effect.gen(function* () {
            const approval = yield* step.waitForEvent("wait-approval", OrderApproved, {
              timeout: Duration.hours(24),
              if: `async.data.orderId == "${event.orderId}"`,
            });

            if (Option.isNone(approval)) {
              return { status: "timeout" as const, orderId: event.orderId };
            }
            return { status: "approved" as const, approvedBy: approval.value.approvedBy };
          }),
      });

      const { handler, dispose } = InngestGroup.toWebHandler(Group, { layer: makeTestLayer(HandlersLive) });

      try {
        const stepHash = "df213fbba68cded20d69d058d0047d7233586642";

        const response = yield* Effect.tryPromise(() =>
          handler(
            request({
              [stepHash]: { data: null },
            }),
          ),
        );

        expect(response.status).toBe(200);
        expect(yield* Effect.tryPromise(() => response.json())).toEqual({
          status: "timeout",
          orderId: "order_123",
        });
      } finally {
        yield* Effect.tryPromise(() => dispose());
      }
    }),
  );

  it.effect("waitForEvent without match expression", () =>
    Effect.gen(function* () {
      const HandlersLive = Group.toLayer({
        "approval-flow": ({ step }) =>
          Effect.gen(function* () {
            const approval = yield* step.waitForEvent("wait-any-approval", OrderApproved, {
              timeout: Duration.minutes(30),
            });

            if (Option.isNone(approval)) {
              return { status: "timeout" as const, orderId: "" };
            }
            return { status: "approved" as const, approvedBy: approval.value.approvedBy };
          }),
      });

      const { handler, dispose } = InngestGroup.toWebHandler(Group, { layer: makeTestLayer(HandlersLive) });

      try {
        const response = yield* Effect.tryPromise(() => handler(request()));

        expect(response.status).toBe(206);

        const body = yield* Effect.tryPromise(() => response.json()).pipe(
          Effect.flatMap(Schema.decodeUnknownEffect(WaitForEventOpcodeResponse)),
        );

        const opcode = body[0]!;
        expect(opcode.opts.event).toBe("order/approved");
        expect(opcode.opts.timeout).toBe("30m");
        expect(opcode.opts.if).toBeUndefined();
      } finally {
        yield* Effect.tryPromise(() => dispose());
      }
    }),
  );

  it.effect("waitForEvent with various timeout durations", () =>
    Effect.gen(function* () {
      const HandlersLive = Group.toLayer({
        "approval-flow": ({ step }) =>
          Effect.gen(function* () {
            const approval = yield* step.waitForEvent("wait-7d", OrderApproved, {
              timeout: Duration.days(7),
            });

            if (Option.isNone(approval)) {
              return { status: "timeout" as const, orderId: "" };
            }
            return { status: "approved" as const, approvedBy: "" };
          }),
      });

      const { handler, dispose } = InngestGroup.toWebHandler(Group, { layer: makeTestLayer(HandlersLive) });

      try {
        const response = yield* Effect.tryPromise(() => handler(request()));

        expect(response.status).toBe(206);

        const body = yield* Effect.tryPromise(() => response.json()).pipe(
          Effect.flatMap(Schema.decodeUnknownEffect(WaitForEventOpcodeResponse)),
        );

        expect(body[0]!.opts.timeout).toBe("1w");
      } finally {
        yield* Effect.tryPromise(() => dispose());
      }
    }),
  );
});
