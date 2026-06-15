import type { Inngest, InngestFunction } from "inngest";

export interface NativeEventInput {
  readonly name: string;
  readonly data: unknown;
  readonly id?: string;
}

export interface NativeExpectedRun {
  readonly functionId: string;
  readonly status?:
    | "CANCELLED"
    | "CANCELED"
    | "COMPLETED"
    | "FAILED"
    | "TIMED_OUT"
    | ReadonlyArray<"CANCELLED" | "CANCELED" | "COMPLETED" | "FAILED" | "TIMED_OUT">;
}

export interface NativeEventCase {
  readonly kind: "event";
  readonly eventKey?: string;
  readonly events: ReadonlyArray<NativeEventInput>;
  readonly afterEvents?: ReadonlyArray<{
    readonly delayMs: number;
    readonly eventKey?: string;
    readonly events: ReadonlyArray<NativeEventInput>;
  }>;
  readonly expect?: ReadonlyArray<NativeExpectedRun>;
}

export interface NativeExample {
  readonly id: string;
  readonly functions: ReadonlyArray<InngestFunction.Like>;
  readonly cases: ReadonlyArray<NativeEventCase>;
}

export type NativeExampleFactory = (inngest: Inngest.Any) => NativeExample;

export const defineNativeExample = (factory: NativeExampleFactory): NativeExampleFactory => factory;

export const eventCase = (input: Omit<NativeEventCase, "kind">): NativeEventCase => ({
  kind: "event",
  ...input,
});
