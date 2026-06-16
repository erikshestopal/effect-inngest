import { Array as Arr, Effect, Function, Option, Predicate, Schema } from "effect";
import type { InngestFunction } from "../../../Function.js";
import type * as InngestEvent from "../../../Event.js";
import * as InngestEvents from "../../../Events.js";
import type { ExecutionEvent, ExecutionInput } from "../domain/ExecutionInput.js";
import { eventSchemaFor, eventSchemas } from "../domain/FunctionDefinition.js";

export type EventSchema = InngestEvent.EventDefinition;

export class EventDecodeError extends Schema.TaggedErrorClass<EventDecodeError>()("EventDecodeError", {
  eventName: Schema.String,
  cause: Schema.Unknown,
}) {}

export const isFunctionInvoked = Schema.is(InngestEvents.FunctionInvoked);

export const envelope = <const Name extends string, const DataSchema extends Schema.Top>(
  event: InngestEvent.EventDefinition<Name, DataSchema>,
) =>
  Schema.Struct({
    name: Schema.tag(event.identifier),
    data: event.schema,
    id: Schema.optional(Schema.String),
    ts: Schema.optional(Schema.Number),
    v: Schema.optional(Schema.String),
  });

export const decodeEnvelope: {
  <E extends EventSchema>(event: E): (value: unknown) => Effect.Effect<InngestEvent.EventType<E>, EventDecodeError>;
  <E extends EventSchema>(value: unknown, event: E): Effect.Effect<InngestEvent.EventType<E>, EventDecodeError>;
} = Function.dual(
  2,
  <Name extends string, DataSchema extends Schema.Top>(
    value: unknown,
    event: InngestEvent.EventDefinition<Name, DataSchema>,
  ) => {
    const eventEnvelope = envelope(event);
    const decode = Schema.decodeUnknownEffect(Schema.toCodecJson(eventEnvelope));

    return decode(value).pipe(
      Effect.mapError((cause) => EventDecodeError.make({ eventName: event.identifier, cause })),
    );
  },
);

export const decodeTriggerEvent: {
  <F extends InngestFunction.Any>(
    fn: F,
  ): (event: ExecutionEvent) => Effect.Effect<InngestFunction.EventPayload<F>, EventDecodeError>;
  <F extends InngestFunction.Any>(
    event: ExecutionEvent,
    fn: F,
  ): Effect.Effect<InngestFunction.EventPayload<F>, EventDecodeError>;
} = Function.dual(2, <F extends InngestFunction.Any>(event: ExecutionEvent, fn: F) =>
  Option.match(eventSchemaFor({ fn, eventName: event.name }), {
    onNone: () =>
      Effect.fail(EventDecodeError.make({ eventName: event.name, cause: "No matching event trigger schema" })),
    onSome: (eventSchema) => decodeEnvelope(eventSchema)(event),
  }),
);

export function decodeInvocation<F extends InngestFunction.Any>(args: {
  readonly fn: F;
  readonly input: ExecutionInput;
}): Effect.Effect<InngestFunction.EventType<F>, EventDecodeError>;
export function decodeInvocation<F extends InngestFunction.Any>(args: {
  readonly fn: F;
  readonly input: ExecutionInput;
}): Effect.Effect<InngestFunction.EventPayload<F> | ReadonlyArray<InngestFunction.EventPayload<F>>, EventDecodeError> {
  const { fn, input } = args;
  if (Predicate.isNotNullish(fn.options?.batchEvents)) {
    return Effect.forEach(input.events, decodeTriggerEvent(fn));
  }

  if (isFunctionInvoked(input.event)) {
    const { _inngest, ...payload } = input.event.data;
    return Option.match(Arr.head(eventSchemas(fn)), {
      onNone: () =>
        Effect.fail(
          EventDecodeError.make({ eventName: input.event.name, cause: "No event trigger schema for invocation" }),
        ),
      onSome: (event) => decodeEnvelope(event)({ name: event.identifier, data: payload }),
    });
  }

  return decodeTriggerEvent(fn)(input.event);
}
