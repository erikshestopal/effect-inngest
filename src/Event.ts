/**
 * Public event definitions.
 *
 * Inngest events are protocol-shaped: `{ name, data, id?, ts?, v? }`.
 * The event name is the discriminator; user payload lives under `data`.
 *
 * @since 0.1.0
 */
import { Predicate, Schema } from "effect";
import type { MakeOptions } from "effect/Schema";

const TypeId: unique symbol = Symbol.for("effect-inngest/Event");

interface EventOptions extends MakeOptions {
  readonly id?: string;
  readonly ts?: number;
  readonly v?: string;
}

export interface EventEnvelope<Name extends string, Data> extends EventOptions {
  readonly name: Name;
  readonly data: Data;
}

type EventFields<Name extends string, DataSchema extends Schema.Top> = {
  readonly name: Schema.tag<Name>;
  readonly data: DataSchema;
  readonly id: Schema.optional<Schema.String>;
  readonly ts: Schema.optional<Schema.Number>;
  readonly v: Schema.optional<Schema.String>;
};

type EventStruct<Name extends string, DataSchema extends Schema.Top> = Schema.Struct<EventFields<Name, DataSchema>>;

type EventConstructor<Name extends string, DataSchema extends Schema.Top> = abstract new (
  _: never,
) => EventEnvelope<Name, Schema.Schema.Type<DataSchema>>;

type PayloadConstructor<Name extends string, DataSchema extends Schema.Top> = {
  bivariance(
    data: Schema.Schema.Type<DataSchema>,
    options?: EventOptions,
  ): EventEnvelope<Name, Schema.Schema.Type<DataSchema>>;
}["bivariance"];

export type EventDefinition<
  Name extends string = string,
  DataSchema extends Schema.Top = Schema.Top,
> = EventConstructor<Name, DataSchema> &
  Omit<
    Schema.Opaque<EventEnvelope<Name, Schema.Schema.Type<DataSchema>>, EventStruct<Name, DataSchema>, {}>,
    "make" | "~type.make"
  > & {
    readonly [TypeId]: typeof TypeId;
    readonly identifier: Name;
    readonly schema: DataSchema;
    readonly make: unknown extends Schema.Schema.Type<DataSchema>
      ? (data: never, options?: EventOptions) => EventEnvelope<Name, unknown>
      : PayloadConstructor<Name, DataSchema>;
    readonly "~type.make": EventEnvelope<Name, Schema.Schema.Type<DataSchema>>;
  };

export type EventData<Event extends EventDefinition> =
  Event extends EventDefinition<any, infer S> ? Schema.Schema.Type<S> : never;

export type EventType<Event extends EventDefinition> =
  Event extends EventDefinition<infer Name, infer S> ? EventEnvelope<Name, Schema.Schema.Type<S>> : never;

export function make<const Name extends string>(name: Name): EventDefinition<Name, Schema.Struct<{}>>;
export function make<const Name extends string, const DataSchema extends Schema.Top>(
  name: Name,
  schema: DataSchema,
): EventDefinition<Name, DataSchema>;
export function make<const Name extends string, const DataSchema extends Schema.Top = Schema.Struct<{}>>(
  name: Name,
  schema: DataSchema = Schema.Struct({}) as unknown as DataSchema,
): EventDefinition<Name, DataSchema> {
  const fields = {
    name: Schema.tag(name),
    data: schema,
    id: Schema.optional(Schema.String),
    ts: Schema.optional(Schema.Number),
    v: Schema.optional(Schema.String),
  } as unknown as EventFields<Name, DataSchema>;

  const Event = Schema.Opaque<EventEnvelope<Name, Schema.Schema.Type<DataSchema>>>()(Schema.Struct(fields));

  abstract class InngestEvent {
    declare readonly _event: Name;

    static readonly [TypeId] = TypeId;
    static readonly identifier = name;
    static readonly schema = schema;

    static make(data: Schema.Schema.Type<DataSchema>, options?: EventOptions) {
      const { id, ts, v } = options ?? {};
      return { name, data, id, ts, v };
    }
  }

  Object.setPrototypeOf(InngestEvent, Event);

  return InngestEvent as unknown as EventDefinition<Name, DataSchema>;
}

export const isEventSchema = (value: unknown): value is EventDefinition =>
  Schema.isSchema(value) && Predicate.hasProperty(value, TypeId);
