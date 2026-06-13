import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { InngestFunction, InngestGroup } from "effect-inngest";
import { defineExample, eventCase } from "./_support.ts";

class DemoIdempotent extends Schema.TaggedClass<DemoIdempotent>()("demo/idempotent", {
  cartId: Schema.String,
}) {}

const IdempotentFn = InngestFunction.make("checkout-handler", {
  trigger: { event: DemoIdempotent },
  idempotency: "event.data.cartId",
  success: Schema.Struct({ checkoutId: Schema.String }),
});

const Group = InngestGroup.make(IdempotentFn);

const HandlersLive = Group.toLayer({
  "checkout-handler": ({ event }) => Effect.succeed({ checkoutId: `checkout-for-${event.cartId}` }),
});

export default defineExample({
  id: "023-idempotency",
  group: Group,
  handlers: HandlersLive,
  cases: [
    eventCase({
      events: [
        {
          name: "demo/idempotent",
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
