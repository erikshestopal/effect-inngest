import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { InngestFunction, InngestGroup, InngestEvent } from "effect-inngest";
import { defineExample, eventCase } from "./_support.ts";

const UserCreated = InngestEvent.make(
  "user.created",
  Schema.Struct({
    userId: Schema.String,
  }),
);

const UserDeleted = InngestEvent.make(
  "user.deleted",
  Schema.Struct({
    userId: Schema.String,
  }),
);

const UserEventsFn = InngestFunction.make("handle-user-events", {
  trigger: [UserCreated, UserDeleted],
});

const Group = InngestGroup.make(UserEventsFn);

const HandlersLive = Group.toLayer({
  "handle-user-events": ({ event }) =>
    Effect.succeed({
      eventType: event.name,
      userId: event.data.userId,
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
