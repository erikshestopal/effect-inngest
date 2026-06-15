import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import { InngestFunction, InngestGroup, InngestEvent } from "effect-inngest";
import { defineExample, eventCase } from "./_support.ts";

class EmailService extends Context.Service<
  EmailService,
  {
    readonly send: (to: string, subject: string, body: string) => Effect.Effect<void>;
  }
>()("EmailService") {}

const EmailServiceLive = Layer.succeed(EmailService, {
  send: (to, subject, body) =>
    Effect.sync(() => {
      console.log(`[EMAIL] To: ${to}, Subject: ${subject}, Body: ${body}`);
    }),
});

const DemoWithServices = InngestEvent.make(
  "demo/with-services",
  Schema.Struct({
    name: Schema.String,
  }),
);

const ServiceFn = InngestFunction.make("service-handler", {
  trigger: { event: DemoWithServices },
  success: Schema.Struct({ sent: Schema.Boolean }),
});

const Group = InngestGroup.make(ServiceFn);

const HandlersLive = Group.toLayer({
  "service-handler": ({ event }) =>
    Effect.gen(function* () {
      const email = yield* EmailService;
      yield* email.send("user@example.com", "Welcome!", `Hello ${event.data.name}, welcome to our service!`);
      return { sent: true };
    }),
}).pipe(Layer.provide(EmailServiceLive));

export default defineExample({
  id: "030-context-services",
  group: Group,
  handlers: HandlersLive,
  cases: [
    eventCase({
      events: [
        {
          name: "demo/with-services",
          data: {
            name: "Ada",
          },
        },
      ],
      expect: [
        {
          functionTag: "service-handler",
        },
      ],
    }),
  ],
});
