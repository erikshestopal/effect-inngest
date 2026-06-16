import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { InngestFunction, InngestGroup, InngestEvent } from "effect-inngest";
import { defineExample, eventCase } from "./_support.ts";

const UserCreated = InngestEvent.make(
  "examples/105-httpapi-multiple-functions/user/created",
  Schema.Struct({
    userId: Schema.String,
    email: Schema.String,
  }),
);

const UserDeleted = InngestEvent.make(
  "examples/105-httpapi-multiple-functions/user/deleted",
  Schema.Struct({
    userId: Schema.String,
  }),
);

const OnUserCreated = InngestFunction.make("on-user-created", {
  trigger: { event: UserCreated },
  success: Schema.Struct({ welcomed: Schema.Boolean }),
});

const OnUserDeleted = InngestFunction.make("on-user-deleted", {
  trigger: { event: UserDeleted },
  success: Schema.Struct({ cleaned: Schema.Boolean }),
});

const Group = InngestGroup.make(OnUserCreated, OnUserDeleted);

const HandlersLive = Group.toLayer({
  "on-user-created": ({ event, step }) =>
    Effect.gen(function* () {
      yield* step.run("send-welcome", Effect.log(`Sending welcome to ${event.data.email}`));
      return { welcomed: true };
    }),
  "on-user-deleted": ({ event, step }) =>
    Effect.gen(function* () {
      yield* step.run("cleanup", Effect.log(`Cleaning up data for ${event.data.userId}`));
      return { cleaned: true };
    }),
});

export default defineExample({
  id: "105-httpapi-multiple-functions",
  group: Group,
  handlers: HandlersLive,
  cases: [
    eventCase({
      events: [
        {
          name: "examples/105-httpapi-multiple-functions/user/created",
          data: {
            userId: "user-105",
            email: "user@example.com",
          },
        },
      ],
      expect: [
        {
          spans: ["send-welcome"],
          functionTag: "on-user-created",
        },
      ],
    }),
  ],
});
