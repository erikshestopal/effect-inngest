import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { InngestFunction, InngestGroup } from "effect-inngest";
import { defineExample, eventCase } from "./_support.ts";

class DemoWaitMatch extends Schema.TaggedClass<DemoWaitMatch>()("demo/wait-match", {
  invoiceId: Schema.String,
}) {}

class DemoInvoicePaid extends Schema.TaggedClass<DemoInvoicePaid>()("demo/invoice-paid", {
  invoiceId: Schema.String,
  amount: Schema.Number,
}) {}

const WaitMatchFn = InngestFunction.make("wait-for-invoice-payment", {
  trigger: { event: DemoWaitMatch },
  success: Schema.Struct({ invoiceId: Schema.String, amount: Schema.NullOr(Schema.Number) }),
});

const Group = InngestGroup.make(WaitMatchFn);

const HandlersLive = Group.toLayer({
  "wait-for-invoice-payment": ({ event, step }) =>
    Effect.gen(function* () {
      yield* Effect.log(`Waiting for payment on invoice: ${event.invoiceId}`);

      const paidEvent = yield* step.waitForEvent("wait-for-payment", DemoInvoicePaid, {
        timeout: Duration.seconds(30),
        if: `async.data.invoiceId == "${event.invoiceId}"`,
      });

      if (Option.isSome(paidEvent)) {
        yield* Effect.log(`Invoice ${event.invoiceId} paid! Amount: ${paidEvent.value.amount}`);
        return { invoiceId: event.invoiceId, amount: paidEvent.value.amount };
      }

      yield* Effect.log(`Payment timeout for invoice: ${event.invoiceId}`);
      return { invoiceId: event.invoiceId, amount: null };
    }),
});

export default defineExample({
  id: "041-waitForEvent-match",
  group: Group,
  handlers: HandlersLive,
  cases: [
    eventCase({
      events: [
        {
          name: "demo/wait-match",
          data: {
            invoiceId: "invoice-041",
          },
        },
      ],
      afterEvents: [
        {
          delayMs: 1000,
          events: [
            {
              name: "demo/invoice-paid",
              data: {
                invoiceId: "invoice-041",
                amount: 123.45,
              },
            },
          ],
        },
      ],
      expect: [
        {
          spans: ["wait-for-payment"],
          functionTag: "wait-for-invoice-payment",
        },
      ],
      timeoutMs: 30000,
    }),
  ],
});
