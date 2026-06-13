import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { InngestFunction, InngestGroup } from "effect-inngest";
import { defineExample, invokeCase } from "./_support.ts";

const CronTimezoneFn = InngestFunction.make("daily-9am-est", {
  trigger: { cron: "TZ=America/New_York 0 9 * * *" },
  success: Schema.Struct({ executedAt: Schema.String, timezone: Schema.String }),
});

const Group = InngestGroup.make(CronTimezoneFn);

const HandlersLive = Group.toLayer({
  "daily-9am-est": () =>
    Effect.gen(function* () {
      const now = new Date().toISOString();
      yield* Effect.log(`Daily 9am EST job executed at: ${now}`);
      return {
        executedAt: now,
        timezone: "America/New_York",
      };
    }),
});

export default defineExample({
  id: "049-cron-timezone",
  group: Group,
  handlers: HandlersLive,
  cases: [
    invokeCase({
      functionTag: "daily-9am-est",
      data: {},
      expect: {
        functionTag: "daily-9am-est",
      },
    }),
  ],
});
