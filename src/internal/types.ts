import type { Patch } from "immer";
import type { SigmaType } from "../framework.js";
import type { Draft, Immutable } from "../immer.js";
import type { EventParameters, SigmaListenerMap } from "../listener.js";
import {
  sigmaEventsBrand,
  sigmaRefBrand,
  sigmaStateBrand,
  sigmaTargetBrand,
  sigmaTypeBrand,
} from "./symbols.js";

type Def = typeof sigmaTypeBrand;

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
export type AnyDefaultState<TState extends object> = {
  [K in keyof TState]?: DefaultStateValue<TState[K]>;
};

/** A cleanup resource supported by setup handlers, including function, `dispose()`, and `Symbol.dispose` cleanup. */
export type AnyResource = Cleanup | Disposable | DisposableLike | AbortController;

type ComputedValues<TComputeds> = {
  readonly [K in keyof TComputeds]: TComputeds[K] extends AnyFunction
    ? Immutable<ReturnType<TComputeds[K]>>
    : never;
};

type QueryMethods<TQueries> = {
  [K in keyof TQueries]: TQueries[K] extends AnyFunction
    ? (...args: Parameters<TQueries[K]>) => ReturnType<TQueries[K]>
    : never;
};

type ActionMethods<TActions> = {
  [K in keyof TActions]: TActions[K] extends AnyFunction
    ? (...args: Parameters<TActions[K]>) => ReturnType<TActions[K]>
    : never;
};

type MergeObjects<TLeft, TRight, TConstraint extends object = object> = TRight extends TConstraint
  ? TLeft extends TConstraint
    ? Simplify<Omit<TLeft, keyof TRight> & TRight>
    : TRight
  : TLeft extends TConstraint
    ? TLeft
    : {};

type Simplify<T> = {} & {
  [K in keyof T]: T[K];
};

export type ComputedContext<
  T extends AnySigmaType,
  TOverrides extends Partial<SigmaDefinition> = {},
> = Simplify<
  Immutable<MergeObjects<T[Def]["state"], TOverrides["state"]>> &
    ComputedValues<MergeObjects<T[Def]["computeds"], TOverrides["computeds"]>>
>;

export type ReadonlyContext<
  T extends AnySigmaType,
  TOverrides extends Partial<SigmaDefinition> = {},
> = Simplify<
  Immutable<MergeObjects<T[Def]["state"], TOverrides["state"]>> &
    ComputedValues<MergeObjects<T[Def]["computeds"], TOverrides["computeds"]>> &
    QueryMethods<MergeObjects<T[Def]["queries"], TOverrides["queries"]>>
>;

export type Emit<T extends AnySigmaType, TOverrides extends Partial<SigmaDefinition> = {}> =
  MergeObjects<T[Def]["events"], TOverrides["events"], AnyEvents> extends infer TEvents
    ? [TEvents] extends [AnyEvents]
      ? <TEvent extends string & keyof TEvents>(
          name: TEvent,
          ...[detail]: EventParameters<TEvents[TEvent]>
        ) => void
      : never
    : never;

export type ActionContext<
  T extends AnySigmaType,
  TOverrides extends Partial<SigmaDefinition> = {},
> = Simplify<
  Draft<MergeObjects<T[Def]["state"], TOverrides["state"]>> &
    ComputedValues<MergeObjects<T[Def]["computeds"], TOverrides["computeds"]>> &
    QueryMethods<MergeObjects<T[Def]["queries"], TOverrides["queries"]>> &
    ActionMethods<MergeObjects<T[Def]["actions"], TOverrides["actions"]>> & {
      /** Publishes the current action draft immediately so later boundaries use committed state. */
      commit(): void;
      /** Emits a typed event from the current action. */
      emit: Emit<T, TOverrides>;
    }
>;

export type SetupContext<
  T extends AnySigmaType,
  TOverrides extends Partial<SigmaDefinition> = {},
> = Simplify<
  SigmaState<T[Def] & TOverrides> & {
    /** Runs a synchronous anonymous action from setup so reads and writes use normal action semantics. */
    act<TResult>(fn: (this: ActionContext<T>) => TResult): TResult;
    /** Emits a typed event from setup. */
    emit: Emit<T, TOverrides>;
  }
>;

export type AnySigmaType = SigmaType<any, any, any> & {
  readonly [sigmaTypeBrand]: {
    state: object;
    events?: object;
    computeds?: object;
    queries?: object;
    actions?: object;
    setupArgs?: any[];
  };
};

/** The public shape shared by all sigma-state instances. */
export interface AnySigmaState {
  readonly [sigmaStateBrand]: true;
  readonly [sigmaTargetBrand]: SigmaListenerMap;
}

/** A sigma-state instance with a typed event map. */
export type AnySigmaStateWithEvents<TEvents extends AnyEvents> = AnySigmaState & {
  readonly [sigmaEventsBrand]: TEvents;
};

/** Options accepted by `sigma.subscribe(instance, handler, options)`. */
export type SigmaSubscribeOptions = {
  /** Includes Immer patches and inverse patches on the delivered change object. */
  patches?: boolean;
};

/** The change object delivered to `sigma.subscribe(instance, handler)` listeners. */
export type SigmaChange<TState extends AnyState, TWithPatches extends boolean = false> = {
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

export type SigmaSignals<T extends SigmaDefinition> = Simplify<
  Immutable<T["state"]> & ComputedValues<T["computeds"]>
>;

export type SigmaReadonly<T extends SigmaDefinition> = Simplify<
  SigmaSignals<T> & QueryMethods<T["queries"]>
>;

export type SigmaChangeListener<
  T extends SigmaDefinition = SigmaDefinition,
  TWithPatches extends boolean = false,
> = (change: SigmaChange<T["state"], TWithPatches>) => void;

type EventMetadata<TEvents extends AnyEvents | undefined> = [undefined] extends [TEvents]
  ? {}
  : {
      readonly [sigmaEventsBrand]: TEvents;
    };

type SetupMethods<TSetupArgs extends any[] | undefined> = [TSetupArgs] extends [undefined]
  ? {}
  : {
      /** Runs every registered setup handler and returns one cleanup function for the active setup. */
      setup(...args: Extract<TSetupArgs, any[]>): Cleanup;
    };

/** The public instance shape produced by a configured sigma type. */
export type SigmaState<T extends SigmaDefinition = SigmaDefinition> = AnySigmaState &
  Simplify<
    SigmaSignals<T> &
      QueryMethods<T["queries"]> &
      ActionMethods<T["actions"]> &
      EventMetadata<T["events"]> &
      SetupMethods<T["setupArgs"]>
  >;

type RequiredKeys<TObject extends object> = {
  [K in keyof TObject]-?: {} extends Pick<TObject, K> ? never : K;
}[keyof TObject];

type MissingInitialKeys<TState extends AnyState, TDefaults extends object> = Exclude<
  RequiredKeys<TState>,
  keyof TDefaults
>;

export type InitialStateInput<TState extends AnyState, TDefaults extends object> = [
  MissingInitialKeys<TState, TDefaults>,
] extends [never]
  ? [initialState?: Partial<TState>]
  : [initialState: Pick<TState, MissingInitialKeys<TState, TDefaults>> & Partial<TState>];

export type ExtendSigmaType<
  T extends SigmaType<any, any, any>,
  TExtension extends Partial<SigmaDefinition>,
> = T & {
  readonly [sigmaTypeBrand]: T[Def] & TExtension;
};

type OmitEmpty<T extends object> = Omit<
  T,
  { [K in keyof T]: [undefined] extends [T[K]] ? K : [{}] extends [T[K]] ? K : never }[keyof T]
>;

export type InferSigmaDefinition<T extends SigmaType<any, any, any>> = Extract<
  Simplify<OmitEmpty<T[Def]>>,
  SigmaDefinition
>;

/** Infers the `setup(...)` argument list for a sigma-state instance. */
export type InferSetupArgs<T extends AnySigmaState> = T extends {
  setup(...args: infer TArgs extends any[]): Cleanup;
}
  ? TArgs
  : never;
