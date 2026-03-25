import { computed, type ReadonlySignal, signal } from "@preact/signals";
import { freeze, type Immutable, type Producer } from "immer";

import {
  AnyStateHandle,
  createStateHandle,
  disposeOwnedResources,
  queryMethods,
  StateContainer,
} from "./internal.ts";

// Don't re-export the entire API; only the most essential parts.
export { batch, computed, untracked } from "@preact/signals";
export { isManagedState } from "./internal.ts";

export type EventsDefinition = Record<string, [any?]>;

type FilterProperties<T extends object, U> = {} & {
  [P in {
    [K in keyof T]: [T[K]] extends [never] ? never : T[K] extends U ? K : never;
  }[keyof T]]: T[P];
};

type InferActions<TProps extends object> = {} & FilterProperties<TProps, (...args: any[]) => any>;

type InferManagedStates<TProps extends object> = {} & FilterProperties<TProps, AnyManagedState>;

type InferPublicProps<TProps extends object> = InferActions<TProps> & InferManagedStates<TProps>;

type OmitManagedStates<TState> = TState extends object
  ? Omit<TState, keyof InferManagedStates<TState>>
  : TState;

type InferState<TProps extends object> = {} & Immutable<{
  [K in keyof FilterProperties<
    TProps,
    ReadonlySignal | StateHandle<any, any> | Lens
  >]: TProps[K] extends ReadonlySignal<infer T> | StateHandle<infer T> | Lens<infer T> ? T : never;
}> &
  Readonly<InferManagedStates<TProps>>;

export type AnyManagedState<TState = any, TEvents extends EventsDefinition = any> = {
  /** Get the underlying signal for an exposed signal-backed public property. */
  get<K extends keyof OmitManagedStates<TState>>(
    key: K,
  ): ReadonlySignal<OmitManagedStates<TState>[K]>;
  get(): ReadonlySignal<TState>;
  /** Read the current immutable public state snapshot without tracking. */
  peek<K extends keyof OmitManagedStates<TState>>(key: K): OmitManagedStates<TState>[K];
  peek(): TState;
  /**
   * Subscribe to the current and future immutable values of one signal-backed
   * public property. Returns a function to unsubscribe.
   */
  subscribe<K extends keyof OmitManagedStates<TState>>(
    key: K,
    listener: (value: OmitManagedStates<TState>[K]) => void,
  ): () => void;
  /** Subscribe to the current and future immutable public state snapshots. */
  subscribe(listener: (value: TState) => void): () => void;
  /**
   * Subscribe to a custom event emitted by this managed state.
   *
   * Your listener receives the emitted argument directly, or no argument at all.
   */
  on<TEvent extends string & keyof TEvents>(
    name: TEvent,
    listener: (...args: TEvents[TEvent]) => void,
  ): () => void;
  /** Dispose this managed state instance and its owned resources. */
  dispose(): void;
  [Symbol.dispose](): void;
};

/**
 * Public instance shape produced by `defineManagedState()` and `useManagedState()`.
 *
 * Returned signals and top-level lenses are exposed as tracked getter
 * properties. Returning the `StateHandle` itself exposes the base state
 * directly as a reactive immutable property.
 */
export type ManagedState<
  TState,
  TEvents extends EventsDefinition = EventsDefinition,
  TProps extends object = Record<string, unknown>,
> = AnyManagedState<TState, TEvents> & Immutable<TState> & TProps;

/**
 * Mark a constructor-returned method as a tracked query.
 *
 * Query methods wrap their body in `computed()`, so reads inside the method
 * participate in signal tracking even after the method is exposed publicly.
 * Query functions read from closed-over handles or signals and do not use an
 * instance receiver. Tagged query methods also skip the default `action()`
 * wrapping step.
 */
export function query<TFunction extends (this: void, ...args: any[]) => any>(
  fn: TFunction,
): TFunction {
  const wrapped = ((...args: Parameters<TFunction>) =>
    computed(() => fn(...args)).value) as TFunction;
  queryMethods.add(wrapped);
  return wrapped;
}

/**
 * Constructor-local access to one top-level property of an object-shaped base
 * state.
 *
 * Lenses only exist on `StateHandle`, and `get()` reads are tracked in the
 * same way as `StateHandle.get()`. `set()` accepts either a replacement value
 * or an Immer producer for that property value.
 */
export type Lens<TState = any> = {
  /** Read the current immutable property value. This read is tracked. */
  get: () => Immutable<TState>;
  /**
   * Replace the property value, or update it with an Immer producer for that
   * property value.
   */
  set: (value: TState | Producer<TState>) => void;
};

/**
 * Constructor-local access to the base state.
 *
 * `TState` may be any non-function value, including primitives.
 *
 * Return this handle from the constructor when you want to expose the base
 * state directly as a reactive immutable property on the managed state.
 *
 * When the base state is object-shaped, the handle also exposes a shallow
 * `Lens` for each top-level property key. Spreading an object-shaped handle
 * into the returned constructor object exposes those top-level lenses as
 * tracked public properties.
 *
 * For ordinary derived values, prefer external functions like
 * `getVisibleTodos(state)` so unused helpers can be tree-shaken. Reach for
 * `computed(() => derive(handle.get()))` only when you need memoized reactive
 * reads as a performance optimization.
 */
export type StateHandle<TState, TEvents extends EventsDefinition = never> = AnyStateHandle<
  TState,
  TEvents
> &
  (TState extends object
    ? TState extends
        | ((...args: any[]) => any)
        | readonly any[]
        | ReadonlyMap<any, any>
        | ReadonlySet<any>
      ? {}
      : { readonly [K in keyof TState]: Lens<TState[K]> }
    : {});

/**
 * Pure constructor function for a managed state definition.
 *
 * The first parameter should be explicitly typed as `StateHandle<...>`. The
 * library infers the internal state and event types from that parameter type.
 *
 * Return only methods, signals, top-level `Lens` values from the provided
 * `StateHandle`, the provided `StateHandle`, or a managed state instance.
 * Returned signals and lenses become tracked getter properties, returning the
 * handle exposes the base state directly as a reactive immutable property, and
 * managed state instances are passed through unchanged.
 */
export type StateConstructor<
  TState,
  TEvents extends EventsDefinition,
  TParams extends any[],
  TProps extends object = {},
> = (
  handle: StateHandle<TState, TEvents>,
  ...params: TParams
) => TProps & {
  [key: string]:
    | ((...args: any[]) => any)
    | AnyManagedState
    | Lens
    | ReadonlySignal
    | StateHandle<any, any>;
};

/**
 * Define a managed state class with a private mutable implementation and an
 * immutable public surface.
 *
 * `TState` may be any non-function value, including primitives.
 *
 * The constructor function's explicitly typed `StateHandle` parameter is what
 * the library uses to infer the internal state and event types.
 *
 * Methods are automatically wrapped with `action()` from `@preact/signals`, so
 * they are untracked and batched unless you opt into tracked reads with
 * `query()`.
 *
 * The state constructor must return an object with properties that are either:
 * - A function (to expose methods)
 * - A signal (to expose derived state)
 * - A top-level lens from the state handle (to expose one reactive property)
 * - The state handle (to expose the reactive immutable base state directly)
 * - A managed state instance (to compose another managed state as a property)
 *
 * Returned signals and top-level lenses are turned into getter properties, so
 * reads are tracked by the `@preact/signals` runtime. When the base state is
 * object-shaped, spreading the `StateHandle` into the returned object exposes
 * its current top-level lenses at once.
 *
 * Events can carry at most one argument.
 *
 * The state constructor should be side-effect free.
 */
export function defineManagedState<
  TState,
  TEvents extends EventsDefinition,
  TParams extends any[],
  TProps extends object = {},
  TInitialState extends TState = TState,
>(constructor: StateConstructor<TState, TEvents, TParams, TProps>, initialState: TInitialState) {
  initialState = freeze(initialState);

  return class extends StateContainer {
    constructor(...params: TParams) {
      const state = signal(initialState as Immutable<TState>);

      let owned: Array<(() => void) | { [Symbol.dispose](): void }> | undefined;
      let disposed = false;

      const dispose = () => {
        if (disposed) {
          return;
        }
        disposed = true;
        const current = owned;
        owned = undefined;
        if (!current) {
          return;
        }
        disposeOwnedResources(current);
      };

      const handle = createStateHandle<TState, TEvents>(
        state,
        (name, detail) => this.dispatchEvent(new CustomEvent(name, { detail })),
        (resources) => {
          const nextResources = Array.isArray(resources) ? resources : [resources];
          if (!nextResources.length) {
            return;
          }
          if (disposed) {
            disposeOwnedResources(nextResources);
          } else {
            (owned ??= []).push(...nextResources);
          }
        },
      );

      const props = constructor(handle, ...params);
      super(state, handle, props, dispose);
    }
  } as unknown as new (
    ...params: TParams
  ) => ManagedState<InferState<TProps>, TEvents, InferPublicProps<TProps>>;
}
