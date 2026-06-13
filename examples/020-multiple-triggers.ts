import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { InngestFunction, InngestGroup } from "effect-inngest";
import { defineExample, eventCase } from "./_support.ts";

class UserCreated extends Schema.TaggedClass<UserCreated>()("user/created", {
  userId: Schema.String,
}) {}

class UserUpdated extends Schema.TaggedClass<UserUpdated>()("user/updated", {
  userId: Schema.String,
}) {}

const UserHandlerFn = InngestFunction.make("user-handler", {
  trigger: [{ event: UserCreated }, { event: UserUpdated }],
  success: Schema.Struct({ eventName: Schema.String, userId: Schema.String, action: Schema.String }),
});

const Group = InngestGroup.make(UserHandlerFn);

const HandlersLive = Group.toLayer({
  "user-handler": ({ event }) =>
    Effect.gen(function* () {
      const action = event._tag === "user/created" ? "Created" : "Updated";
      yield* Effect.log(`User ${action}: ${event.userId}`);
      return { eventName: event._tag, userId: event.userId, action };
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
