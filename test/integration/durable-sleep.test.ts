import * as Effect from "effect/Effect";
import * as Duration from "effect/Duration";
import * as Schema from "effect/Schema";
import { describe, expect, it } from "@effect/vitest";
import { InngestFunction, InngestGroup } from "../../src/index.js";
import * as Protocol from "../../src/internal/protocol.js";
import { makeTestLayer, makeTestRequest } from "./_helpers.js";
import { SleepOpcodeResponse } from "./_schemas.js";

class JobStart extends Schema.TaggedClass<JobStart>()("job/start", {
  jobId: Schema.String,
}) {}

describe("TB-003: Durable Sleep", () => {
  const DelayedProcess = InngestFunction.make("delayed-process", {
    trigger: { event: JobStart },
    success: Schema.String,
  });

  const Group = InngestGroup.make(DelayedProcess);

  const request = (steps: (typeof Protocol.SDKRequestBody.Type)["steps"] = {}) =>
    makeTestRequest({
      fnId: "delayed-process",
      eventName: "job/start",
      eventData: { jobId: "job_1" },
      steps,
    });

  it.effect("returns 206 with Sleep opcode on first invocation", () =>
    Effect.gen(function* () {
      const HandlersLive = Group.toLayer({
        "delayed-process": ({ step }) =>
          Effect.gen(function* () {
            yield* step.sleep("wait-5s", Duration.seconds(5));
            return "completed after sleep";
          }),
      });

      const { handler, dispose } = InngestGroup.toWebHandler(Group, { layer: makeTestLayer(HandlersLive) });

      try {
        const response = yield* Effect.tryPromise(() => handler(request()));

        expect(response.status).toBe(206);

        const body = yield* Effect.tryPromise(() => response.json()).pipe(
          Effect.flatMap(Schema.decodeUnknownEffect(SleepOpcodeResponse)),
        );

        expect(body).toHaveLength(1);
        const opcode = body[0]!;
        expect(opcode.op).toBe(Protocol.Opcode.Sleep);
        // BUG FIX: Duration now goes in `name` field (matches official SDK)
        expect(opcode.name).toBe("5s");
        expect(opcode.displayName).toBe("wait-5s");
        expect(opcode.userland).toEqual({ id: "wait-5s" });
        expect(typeof opcode.id).toBe("string");
        expect(opcode.id.length).toBe(40);

        expect(body).toMatchInlineSnapshot(`
          [
            {
              "data": null,
              "displayName": "wait-5s",
              "id": "56af4c0dbbfd57f3b5cf799d6b506eaaab6c4bd6",
              "name": "5s",
              "op": "Sleep",
              "opts": {},
              "userland": {
                "id": "wait-5s",
              },
            },
          ]
        `);
      } finally {
        yield* Effect.tryPromise(() => dispose());
      }
    }),
  );

  it.effect("returns 200 after sleep completes", () =>
    Effect.gen(function* () {
      const HandlersLive = Group.toLayer({
        "delayed-process": ({ step }) =>
          Effect.gen(function* () {
            yield* step.sleep("wait-5s", Duration.seconds(5));
            return "completed after sleep";
          }),
      });

      const { handler, dispose } = InngestGroup.toWebHandler(Group, { layer: makeTestLayer(HandlersLive) });

      try {
        const stepHash = "56af4c0dbbfd57f3b5cf799d6b506eaaab6c4bd6";

        const response = yield* Effect.tryPromise(() =>
          handler(
            request({
              [stepHash]: { data: null },
            }),
          ),
        );

        expect(response.status).toBe(200);
        expect(yield* Effect.tryPromise(() => response.json())).toBe("completed after sleep");
      } finally {
        yield* Effect.tryPromise(() => dispose());
      }
    }),
  );

  it.effect("sleepUntil emits Sleep opcode with ISO timestamp", () =>
    Effect.gen(function* () {
      const HandlersLive = Group.toLayer({
        "delayed-process": ({ step }) =>
          Effect.gen(function* () {
            const targetDate = new Date("2025-12-31T23:59:59.000Z");
            yield* step.sleepUntil("wait-until-new-year", targetDate);
            return "completed after sleepUntil";
          }),
      });

      const { handler, dispose } = InngestGroup.toWebHandler(Group, { layer: makeTestLayer(HandlersLive) });

      try {
        const response = yield* Effect.tryPromise(() => handler(request()));

        expect(response.status).toBe(206);

        const body = yield* Effect.tryPromise(() => response.json()).pipe(
          Effect.flatMap(Schema.decodeUnknownEffect(SleepOpcodeResponse)),
        );

        expect(body).toHaveLength(1);
        const opcode = body[0]!;
        expect(opcode.op).toBe(Protocol.Opcode.Sleep);
        // BUG FIX: ISO timestamp now goes in `name` field (matches official SDK)
        expect(opcode.name).toBe("2025-12-31T23:59:59.000Z");
        expect(opcode.displayName).toBe("wait-until-new-year");
        expect(opcode.userland).toEqual({ id: "wait-until-new-year" });

        expect(body).toMatchInlineSnapshot(`
          [
            {
              "data": null,
              "displayName": "wait-until-new-year",
              "id": "4b453441a75a26aae48434715f6a221596f312eb",
              "name": "2025-12-31T23:59:59.000Z",
              "op": "Sleep",
              "opts": {},
              "userland": {
                "id": "wait-until-new-year",
              },
            },
          ]
        `);
      } finally {
        yield* Effect.tryPromise(() => dispose());
      }
    }),
  );

  it.effect("sleepUntil with unix timestamp", () =>
    Effect.gen(function* () {
      const HandlersLive = Group.toLayer({
        "delayed-process": ({ step }) =>
          Effect.gen(function* () {
            const targetTs = new Date("2025-06-15T12:00:00.000Z").getTime();
            yield* step.sleepUntil("wait-until-summer", targetTs);
            return "completed";
          }),
      });

      const { handler, dispose } = InngestGroup.toWebHandler(Group, { layer: makeTestLayer(HandlersLive) });

      try {
        const response = yield* Effect.tryPromise(() => handler(request()));

        expect(response.status).toBe(206);

        const body = yield* Effect.tryPromise(() => response.json()).pipe(
          Effect.flatMap(Schema.decodeUnknownEffect(SleepOpcodeResponse)),
        );

        expect(body[0]!.name).toBe("2025-06-15T12:00:00.000Z");
      } finally {
        yield* Effect.tryPromise(() => dispose());
      }
    }),
  );

  it.effect("sleepUntil with ISO string", () =>
    Effect.gen(function* () {
      const HandlersLive = Group.toLayer({
        "delayed-process": ({ step }) =>
          Effect.gen(function* () {
            yield* step.sleepUntil("wait-until-date", "2025-03-15T09:30:00.000Z");
            return "completed";
          }),
      });

      const { handler, dispose } = InngestGroup.toWebHandler(Group, { layer: makeTestLayer(HandlersLive) });

      try {
        const response = yield* Effect.tryPromise(() => handler(request()));

        expect(response.status).toBe(206);

        const body = yield* Effect.tryPromise(() => response.json()).pipe(
          Effect.flatMap(Schema.decodeUnknownEffect(SleepOpcodeResponse)),
        );

        expect(body[0]!.name).toBe("2025-03-15T09:30:00.000Z");
      } finally {
        yield* Effect.tryPromise(() => dispose());
      }
    }),
  );

  it.effect("various Duration formats", () =>
    Effect.gen(function* () {
      const HandlersLive = Group.toLayer({
        "delayed-process": ({ step }) =>
          Effect.gen(function* () {
            yield* step.sleep("wait-1h", Duration.hours(1));
            return "completed";
          }),
      });

      const { handler, dispose } = InngestGroup.toWebHandler(Group, { layer: makeTestLayer(HandlersLive) });

      try {
        const response = yield* Effect.tryPromise(() => handler(request()));

        expect(response.status).toBe(206);

        const body = yield* Effect.tryPromise(() => response.json()).pipe(
          Effect.flatMap(Schema.decodeUnknownEffect(SleepOpcodeResponse)),
        );

        expect(body[0]!.name).toBe("1h");
      } finally {
        yield* Effect.tryPromise(() => dispose());
      }
    }),
  );
});
