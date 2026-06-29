import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { InngestFunction, InngestGroup, InngestEvent, Inngest } from "effect-inngest";
import { defineExample, eventCase } from "./_support.ts";

const DemoWaitMatch = InngestEvent.make(
  "examples/041-waitForEvent-match/demo/wait-match",
  Schema.Struct({
    invoiceId: Schema.String,
  }),
);

const DemoInvoicePaid = InngestEvent.make(
  "examples/041-waitForEvent-match/demo/invoice-paid",
  Schema.Struct({
    invoiceId: Schema.String,
    amount: Schema.Number,
  }),
);

const WaitMatchFn = InngestFunction.make("wait-for-invoice-payment", {
  trigger: { event: DemoWaitMatch },
});

const Group = InngestGroup.make(WaitMatchFn);

const HandlersLive = Group.toLayer({
  "wait-for-invoice-payment": ({ event }) =>
    Effect.gen(function* () {
      yield* Effect.log(`Waiting for payment on invoice: ${event.data.invoiceId}`);

      const paidEvent = yield* Inngest.waitForEvent("wait-for-payment", DemoInvoicePaid, {
        timeout: Duration.seconds(30),
        if: `async.data.invoiceId == "${event.data.invoiceId}"`,
      });

      if (Option.isSome(paidEvent)) {
        yield* Effect.log(`Invoice ${event.data.invoiceId} paid! Amount: ${paidEvent.value.data.amount}`);
        return { invoiceId: event.data.invoiceId, amount: paidEvent.value.data.amount };
      }

      yield* Effect.log(`Payment timeout for invoice: ${event.data.invoiceId}`);
      return { invoiceId: event.data.invoiceId, amount: null };
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
          name: "examples/041-waitForEvent-match/demo/wait-match",
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
              name: "examples/041-waitForEvent-match/demo/invoice-paid",
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
