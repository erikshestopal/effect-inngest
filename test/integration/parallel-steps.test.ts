import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { describe, expect, it } from "@effect/vitest";
import { InngestFunction, InngestGroup, InngestEvent } from "../../src/index.js";
import * as Protocol from "../../src/internal/protocol.js";
import { makeTestLayer, makeTestRequest } from "./_helpers.js";
import { StepOpcodeResponse } from "./_schemas.js";

const FetchUserDataResult = Schema.Struct({
  user: Schema.Struct({ id: Schema.String, name: Schema.String }),
  orders: Schema.Array(Schema.String),
  preferences: Schema.Struct({ theme: Schema.String }),
});

const UserRequested = InngestEvent.make(
  "user/requested",
  Schema.Struct({
    userId: Schema.String,
  }),
);

describe("TB-009: Parallel Step Execution", () => {
  const FetchUserData = InngestFunction.make("fetch-user-data", {
    trigger: { event: UserRequested },
    success: FetchUserDataResult,
  });

  const Group = InngestGroup.make(FetchUserData);

  const request = (steps: (typeof Protocol.SDKRequestBody.Type)["steps"] = {}) =>
    makeTestRequest({
      fnId: "fetch-user-data",
      eventName: "user/requested",
      eventData: { userId: "user_123" },
      steps,
    });

  it.effect("returns 206 with all parallel step opcodes on first invocation", () =>
    Effect.gen(function* () {
      const HandlersLive = Group.toLayer({
        "fetch-user-data": ({ event, step }) =>
          Effect.gen(function* () {
            const [user, orders, preferences] = yield* Effect.all(
              [
                step.run("fetch-user", Effect.succeed({ id: event.data.userId, name: "Alice" })),
                step.run("fetch-orders", Effect.succeed(["order_1", "order_2"])),
                step.run("fetch-preferences", Effect.succeed({ theme: "dark" })),
              ],
              { concurrency: "unbounded" },
            );
            return { user, orders, preferences };
          }),
      });

      const { handler, dispose } = InngestGroup.toWebHandler(Group, { layer: makeTestLayer(HandlersLive) });

      try {
        const response = yield* Effect.tryPromise(() => handler(request()));
        expect(response.status).toBe(206);

        const body = yield* Effect.tryPromise(() => response.json()).pipe(
          Effect.flatMap(Schema.decodeUnknownEffect(StepOpcodeResponse)),
        );

        expect(body).toHaveLength(3);

        const stepNames = body.map((op) => op.name).sort();
        expect(stepNames).toEqual(["fetch-orders", "fetch-preferences", "fetch-user"]);

        body.forEach((op) => {
          expect(op.op).toBe(Protocol.Opcode.StepPlanned);
        });

        expect(body).toMatchInlineSnapshot(`
          [
            {
              "displayName": "fetch-user",
              "id": "857c0b3e9253ce40ce09381575f27504abb803ea",
              "name": "fetch-user",
              "op": "StepPlanned",
            },
            {
              "displayName": "fetch-orders",
              "id": "c30fa0a56ff7801499f87aaa7566f932597320e6",
              "name": "fetch-orders",
              "op": "StepPlanned",
            },
            {
              "displayName": "fetch-preferences",
              "id": "ee5d6542f58813e483077e621bd20d310ac32161",
              "name": "fetch-preferences",
              "op": "StepPlanned",
            },
          ]
        `);
      } finally {
        yield* Effect.tryPromise(() => dispose());
      }
    }),
  );

  it.effect("returns 206 with remaining opcodes when partially memoized", () =>
    Effect.gen(function* () {
      const HandlersLive = Group.toLayer({
        "fetch-user-data": ({ event, step }) =>
          Effect.gen(function* () {
            const [user, orders, preferences] = yield* Effect.all(
              [
                step.run("fetch-user", Effect.succeed({ id: event.data.userId, name: "Alice" })),
                step.run("fetch-orders", Effect.succeed(["order_1", "order_2"])),
                step.run("fetch-preferences", Effect.succeed({ theme: "dark" })),
              ],
              { concurrency: "unbounded" },
            );
            return { user, orders, preferences };
          }),
      });

      const { handler, dispose } = InngestGroup.toWebHandler(Group, { layer: makeTestLayer(HandlersLive) });

      try {
        const firstResponse = yield* Effect.tryPromise(() => handler(request()));
        const firstBody = yield* Effect.tryPromise(() => firstResponse.json()).pipe(
          Effect.flatMap(Schema.decodeUnknownEffect(StepOpcodeResponse)),
        );

        const fetchUserHash = firstBody.find((op) => op.name === "fetch-user")!.id;

        const response = yield* Effect.tryPromise(() =>
          handler(
            request({
              [fetchUserHash]: { data: { id: "user_123", name: "Alice" } },
            }),
          ),
        );

        expect(response.status).toBe(206);

        const body = yield* Effect.tryPromise(() => response.json()).pipe(
          Effect.flatMap(Schema.decodeUnknownEffect(StepOpcodeResponse)),
        );

        expect(body).toHaveLength(2);

        const stepNames = body.map((op) => op.name).sort();
        expect(stepNames).toEqual(["fetch-orders", "fetch-preferences"]);

        const sortedBody = [...body].sort((a, b) => a.name.localeCompare(b.name));
        expect(sortedBody).toMatchInlineSnapshot(`
          [
            {
              "displayName": "fetch-orders",
              "id": "c30fa0a56ff7801499f87aaa7566f932597320e6",
              "name": "fetch-orders",
              "op": "StepPlanned",
            },
            {
              "displayName": "fetch-preferences",
              "id": "ee5d6542f58813e483077e621bd20d310ac32161",
              "name": "fetch-preferences",
              "op": "StepPlanned",
            },
          ]
        `);
      } finally {
        yield* Effect.tryPromise(() => dispose());
      }
    }),
  );

  it.effect("returns 200 with final result when all steps memoized", () =>
    Effect.gen(function* () {
      const HandlersLive = Group.toLayer({
        "fetch-user-data": ({ event, step }) =>
          Effect.gen(function* () {
            const [user, orders, preferences] = yield* Effect.all(
              [
                step.run("fetch-user", Effect.succeed({ id: event.data.userId, name: "Alice" })),
                step.run("fetch-orders", Effect.succeed(["order_1", "order_2"])),
                step.run("fetch-preferences", Effect.succeed({ theme: "dark" })),
              ],
              { concurrency: "unbounded" },
            );
            return { user, orders, preferences };
          }),
      });

      const { handler, dispose } = InngestGroup.toWebHandler(Group, { layer: makeTestLayer(HandlersLive) });

      try {
        const firstResponse = yield* Effect.tryPromise(() => handler(request()));
        const firstBody = yield* Effect.tryPromise(() => firstResponse.json()).pipe(
          Effect.flatMap(Schema.decodeUnknownEffect(StepOpcodeResponse)),
        );

        const fetchUserHash = firstBody.find((op) => op.name === "fetch-user")!.id;
        const fetchOrdersHash = firstBody.find((op) => op.name === "fetch-orders")!.id;
        const fetchPreferencesHash = firstBody.find((op) => op.name === "fetch-preferences")!.id;

        const response = yield* Effect.tryPromise(() =>
          handler(
            request({
              [fetchUserHash]: { data: { id: "user_123", name: "Alice" } },
              [fetchOrdersHash]: { data: ["order_1", "order_2"] },
              [fetchPreferencesHash]: { data: { theme: "dark" } },
            }),
          ),
        );

        expect(response.status).toBe(200);

        const result = yield* Effect.tryPromise(() => response.json()).pipe(
          Effect.flatMap(Schema.decodeUnknownEffect(FetchUserDataResult)),
        );

        expect(result.user).toEqual({ id: "user_123", name: "Alice" });
        expect(result.orders).toEqual(["order_1", "order_2"]);
        expect(result.preferences).toEqual({ theme: "dark" });

        expect(result).toMatchInlineSnapshot(`
          {
            "orders": [
              "order_1",
              "order_2",
            ],
            "preferences": {
              "theme": "dark",
            },
            "user": {
              "id": "user_123",
              "name": "Alice",
            },
          }
        `);
      } finally {
        yield* Effect.tryPromise(() => dispose());
      }
    }),
  );

  it.effect("handles memoization in any order", () =>
    Effect.gen(function* () {
      const HandlersLive = Group.toLayer({
        "fetch-user-data": ({ event, step }) =>
          Effect.gen(function* () {
            const [user, orders, preferences] = yield* Effect.all(
              [
                step.run("fetch-user", Effect.succeed({ id: event.data.userId, name: "Alice" })),
                step.run("fetch-orders", Effect.succeed(["order_1", "order_2"])),
                step.run("fetch-preferences", Effect.succeed({ theme: "dark" })),
              ],
              { concurrency: "unbounded" },
            );
            return { user, orders, preferences };
          }),
      });

      const { handler, dispose } = InngestGroup.toWebHandler(Group, { layer: makeTestLayer(HandlersLive) });

      try {
        const firstResponse = yield* Effect.tryPromise(() => handler(request()));
        const firstBody = yield* Effect.tryPromise(() => firstResponse.json()).pipe(
          Effect.flatMap(Schema.decodeUnknownEffect(StepOpcodeResponse)),
        );

        const fetchUserHash = firstBody.find((op) => op.name === "fetch-user")!.id;
        const fetchOrdersHash = firstBody.find((op) => op.name === "fetch-orders")!.id;

        const response = yield* Effect.tryPromise(() =>
          handler(
            request({
              [fetchOrdersHash]: { data: ["order_1", "order_2"] },
              [fetchUserHash]: { data: { id: "user_123", name: "Alice" } },
            }),
          ),
        );

        expect(response.status).toBe(206);

        const body = yield* Effect.tryPromise(() => response.json()).pipe(
          Effect.flatMap(Schema.decodeUnknownEffect(StepOpcodeResponse)),
        );

        expect(body).toHaveLength(1);
        expect(body[0]!.name).toBe("fetch-preferences");
      } finally {
        yield* Effect.tryPromise(() => dispose());
      }
    }),
  );
});

// Mixed Parallel Steps - Different Opcode Types

const TaskStarted = InngestEvent.make(
  "task/started",
  Schema.Struct({
    taskId: Schema.String,
  }),
);

describe("TB-009: Mixed Parallel Steps (different opcodes)", () => {
  const MixedStepsResult = Schema.Struct({
    result: Schema.String,
    sleptFor: Schema.String,
  });

  const MixedStepsFunction = InngestFunction.make("mixed-steps", {
    trigger: { event: TaskStarted },
    success: MixedStepsResult,
  });

  const MixedGroup = InngestGroup.make(MixedStepsFunction);

  const mixedRequest = (steps: (typeof Protocol.SDKRequestBody.Type)["steps"] = {}) =>
    makeTestRequest({
      fnId: "mixed-steps",
      eventName: "task/started",
      eventData: { taskId: "task_456" },
      steps,
    });

  // Note: For Sleep opcodes, `name` contains the duration (e.g. "5s"), not the step id
  // The step id is in `displayName` for Sleep opcodes
  const MixedOpcodeResponse = Schema.Array(
    Schema.Struct({
      op: Schema.String,
      id: Schema.String,
      name: Schema.String,
      displayName: Schema.String,
      mode: Schema.optional(Schema.Literal("async")),
    }),
  );

  it.effect("returns 206 with both Step and Sleep opcodes", () =>
    Effect.gen(function* () {
      const MixedHandlersLive = MixedGroup.toLayer({
        "mixed-steps": ({ event, step }) =>
          Effect.gen(function* () {
            const [result, _] = yield* Effect.all(
              [
                step.run("compute", Effect.succeed(`processed-${event.data.taskId}`)),
                step.sleep("wait-briefly", "5 seconds"),
              ],
              { concurrency: "unbounded" },
            );
            return { result, sleptFor: "5s" };
          }),
      });

      const { handler, dispose } = InngestGroup.toWebHandler(MixedGroup, { layer: makeTestLayer(MixedHandlersLive) });

      try {
        const response = yield* Effect.tryPromise(() => handler(mixedRequest()));
        expect(response.status).toBe(206);

        const body = yield* Effect.tryPromise(() => response.json()).pipe(
          Effect.flatMap(Schema.decodeUnknownEffect(MixedOpcodeResponse)),
        );

        expect(body).toHaveLength(2);

        const opcodes = body.map((op) => op.op).sort();
        expect(opcodes).toContain(Protocol.Opcode.StepPlanned);
        expect(opcodes).toContain(Protocol.Opcode.Sleep);

        // Use displayName for step identification since Sleep uses name for duration
        const stepDisplayNames = body.map((op) => op.displayName).sort();
        expect(stepDisplayNames).toEqual(["compute", "wait-briefly"]);

        expect(body).toMatchInlineSnapshot(`
          [
            {
              "displayName": "compute",
              "id": "24989d8ee41c1575924630844ad094b55e6b1445",
              "name": "compute",
              "op": "StepPlanned",
            },
            {
              "displayName": "wait-briefly",
              "id": "0129ebf1d0b9a1f56d076639aeedcce17c7b1af5",
              "name": "5s",
              "op": "Sleep",
            },
          ]
        `);
      } finally {
        yield* Effect.tryPromise(() => dispose());
      }
    }),
  );

  it.effect("completes when both step.run and step.sleep are memoized", () =>
    Effect.gen(function* () {
      const MixedHandlersLive = MixedGroup.toLayer({
        "mixed-steps": ({ event, step }) =>
          Effect.gen(function* () {
            const [result, _] = yield* Effect.all(
              [
                step.run("compute", Effect.succeed(`processed-${event.data.taskId}`)),
                step.sleep("wait-briefly", "5 seconds"),
              ],
              { concurrency: "unbounded" },
            );
            return { result, sleptFor: "5s" };
          }),
      });

      const { handler, dispose } = InngestGroup.toWebHandler(MixedGroup, { layer: makeTestLayer(MixedHandlersLive) });

      try {
        const firstResponse = yield* Effect.tryPromise(() => handler(mixedRequest()));
        const firstBody = yield* Effect.tryPromise(() => firstResponse.json()).pipe(
          Effect.flatMap(Schema.decodeUnknownEffect(MixedOpcodeResponse)),
        );

        const computeHash = firstBody.find((op) => op.displayName === "compute")!.id;
        const sleepHash = firstBody.find((op) => op.displayName === "wait-briefly")!.id;

        const response = yield* Effect.tryPromise(() =>
          handler(
            mixedRequest({
              [computeHash]: { data: "processed-task_456" },
              [sleepHash]: { data: null },
            }),
          ),
        );

        expect(response.status).toBe(200);

        const result = yield* Effect.tryPromise(() => response.json()).pipe(
          Effect.flatMap(Schema.decodeUnknownEffect(MixedStepsResult)),
        );

        expect(result.result).toBe("processed-task_456");
        expect(result.sleptFor).toBe("5s");

        expect(result).toMatchInlineSnapshot(`
          {
            "result": "processed-task_456",
            "sleptFor": "5s",
          }
        `);
      } finally {
        yield* Effect.tryPromise(() => dispose());
      }
    }),
  );
});
