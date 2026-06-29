import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { InngestFunction, InngestGroup, InngestEvent } from "effect-inngest";
import { defineExample, eventCase } from "./_support.ts";

const DemoIdempotent = InngestEvent.make(
  "examples/023-idempotency/demo/idempotent",
  Schema.Struct({
    cartId: Schema.String,
  }),
);

const IdempotentFn = InngestFunction.make("checkout-handler", {
  trigger: DemoIdempotent,
  idempotency: "event.data.cartId",
});

const Group = InngestGroup.make(IdempotentFn);

const HandlersLive = Group.toLayer({
  "checkout-handler": ({ event }) => Effect.succeed({ checkoutId: `checkout-for-${event.data.cartId}` }),
});

export default defineExample({
  id: "023-idempotency",
  group: Group,
  handlers: HandlersLive,
  cases: [
    eventCase({
      events: [
        {
          name: "examples/023-idempotency/demo/idempotent",
          data: {
            cartId: "cart-023",
          },
        },
      ],
      expect: [
        {
          functionTag: "checkout-handler",
        },
      ],
    }),
  ],
});
