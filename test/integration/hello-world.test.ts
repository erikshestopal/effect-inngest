import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { describe, expect, it } from "../bun-effect.js";
import { InngestFunction, InngestGroup } from "../../src/index.js";
import * as Protocol from "../../src/internal/protocol.js";
import { makeTestLayer, makeTestRequest } from "./_helpers.js";

// TB-001: Hello World - Minimal Function Execution

class TestHello extends Schema.TaggedClass<TestHello>()("test/hello", {
  name: Schema.String,
}) {}

describe("TB-001: Hello World", () => {
  const HelloWorld = InngestFunction.make("hello-world", {
    trigger: { event: TestHello },
    success: Schema.String,
  });

  const Group = InngestGroup.make(HelloWorld);

  const request = (steps: (typeof Protocol.SDKRequestBody.Type)["steps"] = {}) =>
    makeTestRequest({
      fnId: "hello-world",
      eventName: "test/hello",
      eventData: { name: "World" },
      steps,
      disableImmediateExecution: false,
    });

  it.effect("executes function and returns 200 with result", () =>
    Effect.gen(function* () {
      const HandlersLive = Group.toLayer({
        "hello-world": ({ event }) => Effect.succeed(`Hello, ${event.name}!`),
      });

      const { handler, dispose } = InngestGroup.toWebHandler(Group, { layer: makeTestLayer(HandlersLive) });

      try {
        const response = yield* Effect.tryPromise(() => handler(request()));

        expect(response.status).toBe(200);
        const result = yield* Effect.tryPromise(() => response.json());
        expect(result).toBe("Hello, World!");
      } finally {
        yield* Effect.tryPromise(() => dispose());
      }
    }),
  );
});
