import { Option, Schema } from "effect";
import type { EventTrigger, InngestFunction } from "../../../Function.js";
import type { EventSchema } from "../codec/EventPayload.js";

const EventTriggerShape = Schema.Struct({
  event: Schema.Struct({
    identifier: Schema.String,
  }),
});

const isEventTriggerShape = Schema.is(EventTriggerShape);

const isEventTrigger = (trigger: InngestFunction.Any["triggers"][number]): trigger is EventTrigger<EventSchema> =>
  isEventTriggerShape(trigger);

export const eventSchemaFor = (args: {
  readonly fn: InngestFunction.Any;
  readonly eventName: string;
}): Option.Option<EventSchema> => {
  const triggers = args.fn.triggers.filter(isEventTrigger);
  return Option.fromNullishOr(triggers.find((trigger) => trigger.event.identifier === args.eventName)?.event);
};
