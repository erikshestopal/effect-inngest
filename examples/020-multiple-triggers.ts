import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { InngestFunction, InngestGroup, InngestEvent } from "effect-inngest";
import { defineExample, eventCase } from "./_support.ts";

const UserCreated = InngestEvent.make(
  "user/created",
  Schema.Struct({
    userId: Schema.String,
  }),
);

const UserUpdated = InngestEvent.make(
  "user/updated",
  Schema.Struct({
    userId: Schema.String,
  }),
);

const UserHandlerFn = InngestFunction.make("user-handler", {
  trigger: [{ event: UserCreated }, { event: UserUpdated }],
  success: Schema.Struct({ eventName: Schema.String, userId: Schema.String, action: Schema.String }),
});

const Group = InngestGroup.make(UserHandlerFn);

const HandlersLive = Group.toLayer({
  "user-handler": ({ event }) =>
    Effect.gen(function* () {
      const action = event.name === "user/created" ? "Created" : "Updated";
      yield* Effect.log(`User ${action}: ${event.data.userId}`);
      return { eventName: event.name, userId: event.data.userId, action };
    }),
});

export default defineExample({
  id: "020-multiple-triggers",
  group: Group,
  handlers: HandlersLive,
  cases: [
    eventCase({
      events: [
        {
          name: "user/created",
          data: {
            userId: "user-020",
          },
        },
      ],
      expect: [
        {
          functionTag: "user-handler",
        },
      ],
    }),
  ],
});
