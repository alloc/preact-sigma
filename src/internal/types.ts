import type { ReadonlySignal } from "@preact/signals";
import type { Patch } from "immer";
import type { SigmaType } from "../framework.js";
import type { Draft, Immutable } from "../immer.js";
import { sigmaEventsBrand, sigmaRefBrand, sigmaStateBrand } from "./symbols.js";

export type AnyFunction = (...args: any[]) => any;

export type Cleanup = () => void;
type DefaultStateInitializer<TValue> = (this: void) => TValue;
type DefaultStateValue<TValue> = TValue | DefaultStateInitializer<TValue>;
type Disposable = {
  [Symbol.dispose](): void;
};
type DisposableLike = {
  dispose(): void;
};

interface SigmaRefBrand {
  [sigmaRefBrand]?: true;
}

/** A type brand that keeps a value by reference in sigma's `Draft` and `Immutable` helpers. */
export type SigmaRef<T = unknown> = T & SigmaRefBrand;

/** The event map shape used by sigma types. */
export type AnyEvents = Record<string, object | void>;
/** The top-level state object shape used by sigma types. */
export type AnyState = Record<string, unknown>;

/** The object accepted by `.defaultState(...)`, where each property may be a value or a zero-argument initializer. */
export type AnyDefaultState<TState extends AnyState> = {
  [K in keyof TState]?: DefaultStateValue<TState[K]>;
};

/** A cleanup resource supported by `.setup(...)`, including function, `dispose()`, and `Symbol.dispose` cleanup. */
export type AnyResource = Cleanup | Disposable | DisposableLike | AbortController;

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
      /** Registers a typed event listener and returns an unsubscribe function. */
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
      /** Runs every registered setup handler and returns one cleanup function for the active setup. */
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
    /** Publishes the current action draft immediately so later boundaries use committed state. */
    commit(): void;
    /** Emits a typed event from the current action. */
    emit: Emit<TEvents>;
  };

type DefinitionEvents<T extends SigmaDefinition> = T["events"] extends AnyEvents ? T["events"] : {};
type DefinitionComputeds<T extends SigmaDefinition> = T["computeds"] extends object
  ? T["computeds"]
  : {};
type DefinitionQueries<T extends SigmaDefinition> = T["queries"] extends object ? T["queries"] : {};
type DefinitionActions<T extends SigmaDefinition> = T["actions"] extends object ? T["actions"] : {};

export type AnySigmaType = SigmaType<any, any, any, any, any, any, any>;

/** The public shape shared by all sigma-state instances. */
export interface AnySigmaState extends EventTarget {
  readonly [sigmaStateBrand]: true;
}

/** A sigma-state instance with a typed event map. */
export type AnySigmaStateWithEvents<TEvents extends AnyEvents> = AnySigmaState & {
  readonly [sigmaEventsBrand]: TEvents;
};

/** Options accepted by `.observe(...)`. */
export type SigmaObserveOptions = {
  /** Includes Immer patches and inverse patches on the delivered change object. */
  patches?: boolean;
};

/** The change object delivered to `.observe(...)` listeners. */
export type SigmaObserveChange<TState extends AnyState, TWithPatches extends boolean = false> = {
  readonly newState: Immutable<TState>;
  readonly oldState: Immutable<TState>;
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

interface SignalAccessors<T extends object> {
  /** Returns the underlying signal for a top-level state property or computed. */
  get<K extends keyof T>(key: K): ReadonlySignal<T[K]>;
}

type UnionToIntersection<U> = (U extends any ? (k: U) => void : never) extends (k: infer I) => void
  ? I
  : never;

type Simplify<T> = {} & {
  [K in keyof T]: T[K];
};

// This lets an interface type extend InstanceType<typeof SigmaType>.
type MapSigmaDefinition<T extends SigmaDefinition> = keyof T extends infer K
  ? K extends "state"
    ? Immutable<T[K]> & SignalAccessors<Immutable<T[K]>>
    : K extends "computeds"
      ? ComputedValues<T[K]> & SignalAccessors<ComputedValues<T[K]>>
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

/** The public instance shape produced by a configured sigma type, including signal access inferred from the definition. */
export type SigmaState<T extends SigmaDefinition = SigmaDefinition> = AnySigmaState &
  Simplify<UnionToIntersection<MapSigmaDefinition<T>>>;

export type SetupContext<T extends SigmaDefinition> = SigmaState<T> & {
  /** Runs a synchronous anonymous action from setup so reads and writes use normal action semantics. */
  act<TResult>(
    fn: (
      this: ActionContext<
        T["state"],
        DefinitionEvents<T>,
        DefinitionComputeds<T>,
        DefinitionQueries<T>,
        DefinitionActions<T>
      >,
    ) => TResult,
  ): TResult;
  /** Emits a typed event from setup. */
  emit: T["events"] extends object ? Emit<T["events"]> : never;
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
