import type * as Effect from "effect/Effect";
import type * as Layer from "effect/Layer";
import type * as InngestFunctionModule from "effect-inngest/Function";
import type * as InngestGroupModule from "effect-inngest/Group";

export type ExpectedStatus = "CANCELLED" | "CANCELED" | "COMPLETED" | "FAILED" | "TIMED_OUT";

export interface EventInput {
  readonly name: string;
  readonly data: unknown;
  readonly id?: string;
}

export interface ExpectedRun {
  readonly functionTag: string;
  readonly status?: ExpectedStatus | ReadonlyArray<ExpectedStatus>;
  readonly spans?: ReadonlyArray<string>;
  readonly timeoutMs?: number;
}

export interface DelayedEvents {
  readonly delayMs: number;
  readonly eventKey?: string;
  readonly events: ReadonlyArray<EventInput>;
}

export interface EventExampleCase {
  readonly kind: "event";
  readonly eventKey?: string;
  readonly events: ReadonlyArray<EventInput>;
  readonly afterEvents?: ReadonlyArray<DelayedEvents>;
  readonly expect: ReadonlyArray<ExpectedRun>;
  readonly timeoutMs?: number;
}

export interface InvokeExampleCase {
  readonly kind: "invoke";
  readonly functionTag: string;
  readonly data: unknown;
  readonly expect: ExpectedRun;
  readonly timeoutMs?: number;
}

export interface EffectExampleCase<A = unknown, E = unknown, R = unknown> {
  readonly kind: "effect";
  readonly effect: Effect.Effect<A, E, R>;
  readonly timeoutMs?: number;
}

export type AnyEffectExampleCase = EffectExampleCase<any, any, any>;

export type ExampleCase = EventExampleCase | InvokeExampleCase | AnyEffectExampleCase;

export interface ExampleDefinition<
  Group extends InngestGroupModule.InngestGroup<InngestFunctionModule.InngestFunction.Any> | undefined =
    | InngestGroupModule.InngestGroup<InngestFunctionModule.InngestFunction.Any>
    | undefined,
  Handlers extends Layer.Layer<any, unknown, never> | undefined = Layer.Layer<any, unknown, never> | undefined,
  Cases extends ReadonlyArray<ExampleCase> = ReadonlyArray<ExampleCase>,
> {
  readonly id: string;
  readonly group?: Group;
  readonly handlers?: Handlers;
  readonly cases: Cases;
}

export const expectedRun = (functionTag: string, options: Omit<ExpectedRun, "functionTag"> = {}): ExpectedRun => ({
  functionTag,
  ...options,
});

export const completed = (functionTag: string, spans?: ReadonlyArray<string>): ExpectedRun =>
  expectedRun(functionTag, spans ? { spans } : {});

export const eventCase = (input: Omit<EventExampleCase, "kind">): EventExampleCase => ({
  kind: "event",
  ...input,
});

export const invokeCase = (input: Omit<InvokeExampleCase, "kind">): InvokeExampleCase => ({
  kind: "invoke",
  ...input,
});

export const effectCase = <A, E, R>(
  effect: Effect.Effect<A, E, R>,
  options: Pick<EffectExampleCase<A, E, R>, "timeoutMs"> = {},
): EffectExampleCase<A, E, R> => ({ kind: "effect", effect, ...options });

export const defineExample = <const Definition extends ExampleDefinition>(definition: Definition): Definition =>
  definition;
