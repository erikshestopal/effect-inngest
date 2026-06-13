import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { InngestFunction, InngestGroup } from "effect-inngest";
import { defineExample, eventCase } from "./_support.ts";

class UserCreated extends Schema.TaggedClass<UserCreated>()("user.created", {
  userId: Schema.String,
}) {}

class UserDeleted extends Schema.TaggedClass<UserDeleted>()("user.deleted", {
  userId: Schema.String,
}) {}

const UserEventsFn = InngestFunction.make("handle-user-events", {
  trigger: [{ event: UserCreated }, { event: UserDeleted }],
  success: Schema.Struct({ eventType: Schema.String, userId: Schema.String }),
});

const Group = InngestGroup.make(UserEventsFn);

const HandlersLive = Group.toLayer({
  "handle-user-events": ({ event }) =>
    Effect.succeed({
      eventType: event._tag,
      userId: event.userId,
    }),
});

export default defineExample({
  id: "031-wildcard-trigger",
  group: Group,
  handlers: HandlersLive,
  cases: [
    eventCase({
      events: [
        {
          name: "user.created",
          data: {
            userId: "user-031",
          },
        },
      ],
      expect: [
        {
          functionTag: "handle-user-events",
        },
      ],
    }),
  ],
});
