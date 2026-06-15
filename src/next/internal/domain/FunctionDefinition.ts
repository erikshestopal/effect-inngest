import { Option, Predicate, Schema } from "effect";
import type { EventTrigger, InngestFunction } from "../../../Function.js";
import type { EventSchema } from "../codec/EventPayload.js";

const EventSchemaShape = Schema.declare<EventSchema>(
  (value): value is EventSchema =>
    Schema.isSchema(value) && Predicate.hasProperty(value, "identifier") && Predicate.isString(value.identifier),
);

const EventTriggerShape = Schema.Struct({
  event: EventSchemaShape,
});

const isEventTriggerShape = Schema.is(EventTriggerShape);

const isEventTrigger = (trigger: InngestFunction.Any["triggers"][number]): trigger is EventTrigger<EventSchema> =>
  isEventTriggerShape(trigger);

export const eventSchemas = (fn: InngestFunction.Any): ReadonlyArray<EventSchema> =>
  fn.triggers.filter(isEventTrigger).map((trigger) => trigger.event);

export const eventSchemaFor = (args: {
  readonly fn: InngestFunction.Any;
  readonly eventName: string;
}): Option.Option<EventSchema> => {
  const events = eventSchemas(args.fn);
  return Option.fromNullishOr(events.find((event) => event.identifier === args.eventName));
};
