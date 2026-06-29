import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { InngestFunction, InngestGroup } from "effect-inngest";
import { defineExample, invokeCase } from "./_support.ts";

const CronFn = InngestFunction.make("cron-every-minute", {
  trigger: { cron: "* * * * *" },
});

const Group = InngestGroup.make(CronFn);

const HandlersLive = Group.toLayer({
  "cron-every-minute": () =>
    Effect.gen(function* () {
      const now = new Date().toISOString();
      yield* Effect.log(`Cron executed at: ${now}`);
      return { executedAt: now };
    }),
});

export default defineExample({
  id: "019-cron-trigger",
  group: Group,
  handlers: HandlersLive,
  cases: [
    invokeCase({
      functionTag: "cron-every-minute",
      data: {},
      expect: {
        functionTag: "cron-every-minute",
      },
    }),
  ],
});
