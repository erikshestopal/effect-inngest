import { Array as Arr, Effect, Option, Predicate, Schema } from "effect";
import type { InngestFunction } from "../../../Function.js";
import type * as InngestEvent from "../../../Event.js";
import type { ExecutionInput } from "../domain/ExecutionInput.js";
import { eventSchemaFor, eventSchemas } from "../domain/FunctionDefinition.js";

export type EventSchema = InngestEvent.EventDefinition;

export class EventDecodeError extends Schema.TaggedErrorClass<EventDecodeError>()("EventDecodeError", {
  eventName: Schema.String,
  cause: Schema.Unknown,
}) {}

export const schemaFor = eventSchemaFor;

export const decodeSchema = <E extends EventSchema>(args: {
  readonly event: E;
  readonly eventName: string;
  readonly eventData: unknown;
}): Effect.Effect<InngestEvent.EventType<E>, EventDecodeError, never> =>
  Schema.decodeUnknownEffect(Schema.toCodecJson(args.event as Schema.Top))({
    name: args.eventName,
    data: args.eventData,
  }).pipe(
    Effect.map((event) => event as InngestEvent.EventType<E>),
    Effect.mapError((cause) => EventDecodeError.make({ eventName: args.eventName, cause })),
  ) as Effect.Effect<InngestEvent.EventType<E>, EventDecodeError, never>;

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
      Effect.map((events) => events as unknown as InngestFunction.EventType<F>),
    );
  }

  if (input.event.name === "inngest/function.invoked" && Predicate.isObject(input.event.data)) {
    const { _inngest, ...payload } = input.event.data;
    return Option.match(Arr.head(eventSchemas(fn)), {
      onNone: () => Effect.succeed(payload as unknown as InngestFunction.EventType<F>),
      onSome: (event) =>
        decodeSchema({ event, eventName: event.identifier, eventData: payload }).pipe(
          Effect.map((decoded) => decoded as InngestFunction.EventType<F>),
        ),
    });
  }

  return decode({ fn, eventName: input.event.name, eventData: input.event.data });
};
