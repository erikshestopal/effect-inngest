import { FetchHttpClient } from "@effect/platform";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import { InngestClient } from "../../src/index.js";
import * as Protocol from "../../src/internal/protocol.js";

/** Helper to create a failing effect that bypasses lint rule requiring possible success */
export const failWith = <E>(error: E): Effect.Effect<string, E> => Effect.fail(error) as Effect.Effect<string, E>;

/** Extract JSON from HttpBody */
export const extractBodyJson = (body: {
  readonly _tag: string;
  readonly body?: Uint8Array;
}): Option.Option<unknown> => {
  if (body._tag === "Uint8Array" && body.body) {
    const text = new TextDecoder().decode(body.body);
    return Option.some(JSON.parse(text));
  }
  return Option.none();
};

export const TestClient = InngestClient.layer({ id: "test-app", eventKey: "test-key", mode: "dev" }).pipe(
  Layer.provide(FetchHttpClient.layer),
);

// Request Builder

export interface TestRequestOptions {
  readonly fnId: string;
  readonly eventName: string;
  readonly eventData: Record<string, unknown>;
  readonly steps?: (typeof Protocol.SDKRequestBody.Type)["steps"];
  readonly disableImmediateExecution?: boolean;
}

export const makeTestRequest = (options: TestRequestOptions): Request => {
  const { fnId, eventName, eventData, steps = {}, disableImmediateExecution = true } = options;

  return new Request(`http://localhost/?fnId=${fnId}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(
      Protocol.SDKRequestBody.make({
        event: Protocol.InngestEvent.make({
          name: eventName,
          data: eventData,
          id: "evt_1",
          ts: Date.now(),
        }),
        events: [],
        steps,
        ctx: Protocol.SDKRequestContext.make({
          fn_id: fnId,
          run_id: "run_123",
          env: "test",
          step_id: "step",
          attempt: 0,
          max_attempts: 4,
          stack: Protocol.FunctionStack.make({ stack: [], current: 0 }),
          qi_id: "qi_123",
          disable_immediate_execution: disableImmediateExecution,
          use_api: false,
        }),
        version: 1,
        use_api: false,
      }),
    ),
  });
};

// Test Layer Builder

export const makeTestLayer = <A, E, R>(handlersLayer: Layer.Layer<A, E, R>) =>
  Layer.mergeAll(handlersLayer, TestClient, FetchHttpClient.layer);
