import { Effect, Option, Predicate, Schema } from "effect";
import type { InngestFunction } from "../../../Function.js";
import type { ExecutionInput } from "../domain/ExecutionInput.js";
import { eventSchemaFor } from "../domain/FunctionDefinition.js";

export type EventSchema<A = unknown> = Schema.Codec<A, unknown, never, never> & {
  readonly identifier: string;
};

export class EventDecodeError extends Schema.TaggedErrorClass<EventDecodeError>()("EventDecodeError", {
  eventName: Schema.String,
  cause: Schema.Unknown,
}) {}

export const schemaFor = eventSchemaFor;

export const decodeSchema = <A>(args: {
  readonly event: EventSchema<A>;
  readonly eventName: string;
  readonly eventData: unknown;
}): Effect.Effect<A, EventDecodeError> =>
  Schema.decodeUnknownEffect(Schema.toCodecJson(args.event))(args.eventData).pipe(
    Effect.mapError((cause) => EventDecodeError.make({ eventName: args.eventName, cause })),
  );

export const decode = <F extends InngestFunction.Any>(args: {
  readonly fn: F;
  readonly eventName: string;
  readonly eventData: unknown;
}): Effect.Effect<InngestFunction.EventType<F>, EventDecodeError> =>
  Option.match(eventSchemaFor(args), {
    onNone: () => Effect.succeed(args.eventData as InngestFunction.EventType<F>),
    onSome: (event) =>
      decodeSchema({ event, eventName: args.eventName, eventData: args.eventData }).pipe(
        Effect.map((decoded) => decoded as InngestFunction.EventType<F>),
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
