import * as Effect from "effect/Effect";
import { Predicate } from "effect";
import * as Schema from "effect/Schema";
import { InngestFunction, InngestGroup, InngestEvent, Inngest } from "effect-inngest";
import { NonRetriableError } from "effect-inngest";
import { defineExample, eventCase } from "./_support.ts";

const DemoInvokeFailing = InngestEvent.make("examples/028-invoke-failure/demo/invoke-failing", Schema.Struct({}));

const DemoFailingChild = InngestEvent.make("examples/028-invoke-failure/demo/failing-child", Schema.Struct({}));

const FailingChildFn = InngestFunction.make("failing-child", {
  trigger: DemoFailingChild,
});

const ParentFn = InngestFunction.make("parent-invoker", {
  trigger: DemoInvokeFailing,
});

const Group = InngestGroup.make(FailingChildFn, ParentFn);

const HandlersLive = Group.toLayer({
  "failing-child": () => Effect.fail(new NonRetriableError({ message: "Child always fails" })),

  "parent-invoker": () =>
    Effect.gen(function* () {
      const result = yield* Inngest.invoke("call-child", { function: FailingChildFn, data: {} as never }).pipe(
        Effect.map(() => ({ status: "success" as const })),
        Effect.catch((error) =>
          Effect.succeed({
            status: "caught-error" as const,
            error:
              typeof error === "object" && error !== null && Predicate.hasProperty(error, "message")
                ? String(error.message)
                : "unknown",
          }),
        ),
      );
      return result;
    }),
});

export default defineExample({
  id: "028-invoke-failure",
  group: Group,
  handlers: HandlersLive,
  cases: [
    eventCase({
      events: [
        {
          name: "examples/028-invoke-failure/demo/invoke-failing",
          data: {},
        },
      ],
      expect: [
        {
          functionTag: "parent-invoker",
        },
      ],
      timeoutMs: 30000,
    }),
  ],
});
