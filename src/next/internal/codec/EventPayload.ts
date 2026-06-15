import { Effect, Option, Predicate, Schema } from "effect";
import type { InngestFunction } from "../../../Function.js";
import type { ExecutionInput } from "../domain/ExecutionInput.js";

export type EventSchema<A = unknown> = Schema.Codec<A, unknown, never, never> & {
  readonly identifier: string;
};

export class EventDecodeError extends Schema.TaggedErrorClass<EventDecodeError>()("EventDecodeError", {
  eventName: Schema.String,
  cause: Schema.Unknown,
}) {}

const isEventTrigger = (trigger: InngestFunction.Any["triggers"][number]): trigger is { readonly event: EventSchema } =>
  Predicate.hasProperty(trigger, "event");

export const schemaFor = (args: {
  readonly fn: InngestFunction.Any;
  readonly eventName: string;
}): Option.Option<EventSchema> => {
  const { fn, eventName } = args;
  const triggers = fn.triggers.filter(isEventTrigger);
  return Option.fromNullishOr(
    triggers.find((trigger) => trigger.event.identifier === eventName)?.event ?? triggers[0]?.event,
  );
};

const withEventTag = (args: { readonly event: EventSchema; readonly payload: unknown }): unknown =>
  Predicate.isObject(args.payload) ? { ...args.payload, _tag: args.event.identifier } : args.payload;

export const decode = <F extends InngestFunction.Any>(args: {
  readonly fn: F;
  readonly eventName: string;
  readonly eventData: unknown;
}): Effect.Effect<InngestFunction.EventType<F>, EventDecodeError> =>
  Option.match(schemaFor(args), {
    onNone: () => Effect.succeed(args.eventData as InngestFunction.EventType<F>),
    onSome: (event) =>
      Schema.decodeUnknownEffect(Schema.toCodecJson(event))(withEventTag({ event, payload: args.eventData })).pipe(
        Effect.map((decoded) => decoded as InngestFunction.EventType<F>),
        Effect.mapError((cause) => EventDecodeError.make({ eventName: args.eventName, cause })),
      ),
  });

export const decodeInvocation = <F extends InngestFunction.Any>(args: {
  readonly fn: F;
  readonly input: ExecutionInput;
}): Effect.Effect<InngestFunction.EventType<F>, EventDecodeError> => {
  const { fn, input } = args;
  if (Predicate.isNotNullish(fn.options?.batchEvents)) {
    return Effect.forEach(input.events, (event) => decode({ fn, eventName: event.name, eventData: event.data })).pipe(
      Effect.map((events) => events as InngestFunction.EventType<F>),
    );
  }

  if (input.event.name === "inngest/function.invoked" && Predicate.isObject(input.event.data)) {
    const { _inngest, ...payload } = input.event.data;
    return decode({ fn, eventName: input.event.name, eventData: payload });
  }

  return decode({ fn, eventName: input.event.name, eventData: input.event.data });
};
