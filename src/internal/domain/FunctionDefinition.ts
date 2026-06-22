import { Array as Arr, Option, Predicate, Schema } from "effect";
import type * as InngestEvent from "../../Event.js";
import type { EventTrigger, InngestFunction } from "../../Function.js";

type EventSchema = InngestEvent.EventDefinition;

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

export const eventSchemas = <F extends InngestFunction.Any>(fn: F): ReadonlyArray<InngestFunction.Events<F>> =>
  Arr.map(Arr.filter(fn.triggers, isEventTrigger), (trigger) => trigger.event as InngestFunction.Events<F>);

export const eventSchemaFor = <F extends InngestFunction.Any>(args: {
  readonly fn: F;
  readonly eventName: string;
}): Option.Option<InngestFunction.Events<F>> => {
  const events = eventSchemas(args.fn);
  return Option.fromNullishOr(events.find((event) => event.identifier === args.eventName));
};
