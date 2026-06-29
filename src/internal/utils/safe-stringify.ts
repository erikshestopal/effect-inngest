import { Array as Arr, Option, Predicate } from "effect";

export type Replacer = (this: unknown, key: string, value: unknown) => unknown;
export type CycleReplacer = (this: unknown, key: string, value: unknown) => unknown;

interface State {
  readonly stack: Array<unknown>;
  readonly keys: Array<string>;
}

const findReference = (state: State, value: unknown): Option.Option<number> =>
  Arr.findFirstIndex(state.stack, (candidate) => Object.is(candidate, value));

const isTracked = (state: State, value: unknown): boolean => Option.isSome(findReference(state, value));

const pushReference = (state: State, key: string, value: unknown): void => {
  state.stack.push(value);
  state.keys.push(key);
};

const trimToParent = (state: State, key: string, parentIndex: number): void => {
  state.stack.splice(parentIndex + 1);
  state.keys.splice(parentIndex, Infinity, key);
};

const refreshParent = (state: State, key: string, parent: unknown): void => {
  Option.match(findReference(state, parent), {
    onNone: () => {
      if (Predicate.isObjectOrArray(parent)) {
        pushReference(state, key, parent);
      }
    },
    onSome: (parentIndex) => trimToParent(state, key, parentIndex),
  });
};

const defaultCycleReplacer = (state: State): CycleReplacer =>
  function (_key, value) {
    const valueIndex = Option.getOrElse(findReference(state, value), () => -1);
    if (Object.is(state.stack[0], value)) {
      return "[Circular ~]";
    }
    return `[Circular ~.${state.keys.slice(0, valueIndex).join(".")}]`;
  };

export function stringify(
  obj: unknown,
  replacer?: Replacer,
  spaces?: string | number,
  cycleReplacer?: CycleReplacer,
): string | undefined {
  return JSON.stringify(obj, getSerialize(replacer, cycleReplacer), spaces);
}

export const normalize = (value: unknown): unknown => {
  const json = stringify(value, (_key, child) => {
    if (!Predicate.isBigInt(child)) {
      return child;
    }
  });

  return Predicate.isUndefined(json) ? null : JSON.parse(json);
};

export function getSerialize(replacer?: Replacer, cycleReplacer?: CycleReplacer): Replacer {
  const state: State = { stack: [], keys: [] };
  const replaceCycle = cycleReplacer ?? defaultCycleReplacer(state);

  return function (key, value) {
    if (Arr.isArrayNonEmpty(state.stack)) {
      refreshParent(state, key, this);

      if (Predicate.isObjectKeyword(value) && isTracked(state, value)) {
        value = replaceCycle.call(this, key, value);
      }
    } else {
      state.stack.push(value);
    }

    return replacer ? replacer.call(this, key, value) : value;
  };
}

export default stringify;
