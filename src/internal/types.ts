import type { ReadonlySignal } from "@preact/signals";
import type { Patch } from "immer";
import type { Draft, Immutable } from "../immer";
import { sigmaEventsBrand, sigmaRefBrand, sigmaStateBrand } from "./symbols.js";

export type AnyFunction = (...args: any[]) => any;

export type Cleanup = () => void;
type DefaultStateInitializer<TValue> = (this: void) => TValue;
type DefaultStateValue<TValue> = TValue | DefaultStateInitializer<TValue>;
type Disposable = {
  [Symbol.dispose](): void;
};

/** The event map shape used by sigma types. */
export type AnyEvents = Record<string, object | void>;
/** The top-level state object shape used by sigma types. */
export type AnyState = Record<string, unknown>;

/** The object accepted by `.defaultState(...)`. */
export type AnyDefaultState<TState extends AnyState> = {
  [K in keyof TState]?: DefaultStateValue<TState[K]>;
};

/** A cleanup resource supported by `.setup(...)`. */
export type AnyResource = Cleanup | Disposable | AbortController;

/** A value marked with `ref(...)`. */
export type SigmaRef<T extends object = object> = T & {
  readonly [sigmaRefBrand]: true;
};

export type ComputedValues<TComputeds extends object | undefined> = [undefined] extends [TComputeds]
  ? never
  : {
      readonly [K in keyof TComputeds]: TComputeds[K] extends AnyFunction
        ? Immutable<ReturnType<TComputeds[K]>>
        : never;
    };

export type ComputedContext<
  TState extends AnyState,
  TComputeds extends object,
> = Immutable<TState> & ComputedValues<TComputeds>;

export type QueryMethods<TQueries extends object | undefined> = [undefined] extends [TQueries]
  ? never
  : {
      [K in keyof TQueries]: TQueries[K] extends AnyFunction
        ? (...args: Parameters<TQueries[K]>) => ReturnType<TQueries[K]>
        : never;
    };

export type ActionMethods<TActions extends object | undefined> = [undefined] extends [TActions]
  ? never
  : {
      [K in keyof TActions]: TActions[K] extends AnyFunction
        ? (...args: Parameters<TActions[K]>) => ReturnType<TActions[K]>
        : never;
    };

export type EventMethods<TEvents extends AnyEvents | undefined> = [undefined] extends [TEvents]
  ? never
  : {
      readonly [sigmaEventsBrand]: TEvents;
      on<TEvent extends string & keyof TEvents>(
        name: TEvent,
        listener: [TEvents[TEvent]] extends [void]
          ? () => void
          : (payload: TEvents[TEvent]) => void,
      ): Cleanup;
    };

export type SetupMethods<TSetupArgs extends any[] | undefined> = [TSetupArgs] extends [undefined]
  ? never
  : {
      setup(...args: Extract<TSetupArgs, any[]>): Cleanup;
    };

export type ReadonlyContext<
  TState extends AnyState,
  TComputeds extends object,
  TQueries extends object,
> = Immutable<TState> & ComputedValues<TComputeds> & QueryMethods<TQueries>;

export type Emit<TEvents extends AnyEvents> = <TEvent extends string & keyof TEvents>(
  name: TEvent,
  ...args: [TEvents[TEvent]] extends [void] ? [] : [payload: TEvents[TEvent]]
) => void;

export type ActionContext<
  TState extends AnyState,
  TEvents extends AnyEvents,
  TComputeds extends object,
  TQueries extends object,
  TActions extends object,
> = Draft<TState> &
  ComputedValues<TComputeds> &
  QueryMethods<TQueries> &
  ActionMethods<TActions> & {
    emit: Emit<TEvents>;
  };

/** The public shape shared by all sigma-state instances. */
export type AnySigmaState = EventTarget & {
  readonly [sigmaStateBrand]: true;
};

/** A sigma-state instance with a typed event map. */
export type AnySigmaStateWithEvents<TEvents extends AnyEvents> = AnySigmaState & {
  readonly [sigmaEventsBrand]: TEvents;
};

/** Options accepted by `.observe(...)`. */
export type SigmaObserveOptions = {
  patches?: boolean;
};

/** The change object delivered to `.observe(...)` listeners. */
export type SigmaObserveChange<TState extends AnyState, TWithPatches extends boolean = false> = {
  readonly previousState: Immutable<TState>;
  readonly state: Immutable<TState>;
} & (TWithPatches extends true
  ? {
      readonly inversePatches: readonly Patch[];
      readonly patches: readonly Patch[];
    }
  : {});

export type SigmaDefinition = {
  state: AnyState;
  events?: AnyEvents;
  computeds?: object;
  queries?: object;
  actions?: object;
  setupArgs?: any[];
};

type UnionToIntersection<U> = (U extends any ? (k: U) => void : never) extends (k: infer I) => void
  ? I
  : never;

// Use this overly complex type so that `SigmaState` isn't erased.
type MapSigmaDefinition<T extends SigmaDefinition> = keyof T extends infer K
  ? K extends "state"
    ? Immutable<T[K]>
    : K extends "computeds"
      ? ComputedValues<T[K]>
      : K extends "queries"
        ? QueryMethods<T[K]>
        : K extends "actions"
          ? ActionMethods<T[K]>
          : K extends "events"
            ? EventMethods<T[K]>
            : K extends "setupArgs"
              ? SetupMethods<T[K]>
              : never
  : never;

/** The public instance shape produced by a configured sigma type. */
export type SigmaState<T extends SigmaDefinition = SigmaDefinition> = AnySigmaState &
  UnionToIntersection<
    | MapSigmaDefinition<T>
    | {
        get<K extends keyof T["state"]>(key: K): ReadonlySignal<Immutable<T["state"][K]>>;
        get<K extends keyof T["computeds"]>(
          key: K,
        ): ReadonlySignal<ComputedValues<T["computeds"]>[K]>;
      }
  >;

export type SetupContext<T extends SigmaDefinition> = SigmaState<T> & {
  emit: T["events"] extends object ? Emit<T["events"]> : never;
};

type Simplify<T extends object> = {} & {
  [K in keyof T]: T[K];
};

export type MergeObjects<TLeft extends object, TRight> = [TRight] extends [object]
  ? Extract<Simplify<Omit<TLeft, keyof TRight> & TRight>, TLeft>
  : TLeft;

type RequiredKeys<TObject extends object> = {
  [K in keyof TObject]-?: {} extends Pick<TObject, K> ? never : K;
}[keyof TObject];

type MissingInitialKeys<
  TState extends AnyState,
  TDefaults extends AnyDefaultState<TState> | undefined,
> = Exclude<RequiredKeys<TState>, keyof NonNullable<TDefaults>>;

export type InitialStateInput<
  TState extends AnyState,
  TDefaults extends AnyDefaultState<TState> | undefined,
> = [MissingInitialKeys<TState, TDefaults>] extends [never]
  ? [initialState?: Partial<TState>]
  : [initialState: Pick<TState, MissingInitialKeys<TState, TDefaults>> & Partial<TState>];

// Specialized Omit type to encourage type erasure.
type Omit<T, K> = {} & { [P in Exclude<keyof T, K>]: T[P] };
export type OmitEmpty<T extends object> = {} & Omit<
  T,
  { [K in keyof T]: [undefined] extends [T[K]] ? K : [{}] extends [T[K]] ? K : never }[keyof T]
>;

/** Infers the `setup(...)` argument list for a sigma-state instance. */
export type InferSetupArgs<T extends AnySigmaState> = T extends {
  setup(...args: infer TArgs extends any[]): Cleanup;
}
  ? TArgs
  : never;
