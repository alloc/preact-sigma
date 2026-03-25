import {
  action,
  computed,
  ReadonlySignal,
  Signal,
  signal,
} from "@preact/signals";
import { castImmutable, freeze, Immutable, produce, Producer } from "immer";
import { useCallback, useEffect, useRef, useState } from "preact/hooks";

// Don't re-export the entire API; only the most essential parts.
export { batch, computed, untracked } from "@preact/signals";

type EventTypes = Record<string, [any?]>;

type FilterProperties<T extends object, U> = {} & {
  [P in {
    [K in keyof T]: [T[K]] extends [never] ? never : T[K] extends U ? K : never;
  }[keyof T]]: T[P];
};

type InferActions<TProps extends object> = {} & FilterProperties<
  TProps,
  (...args: any[]) => any
>;

type InferManagedStates<TProps extends object> = {} & FilterProperties<
  TProps,
  AnyManagedState
>;

type InferPublicProps<TProps extends object> = InferActions<TProps> &
  InferManagedStates<TProps>;

type OnlyPlainObject<TState> = TState extends object
  ? TState extends
      | ((...args: any[]) => any)
      | readonly any[]
      | ReadonlyMap<any, any>
      | ReadonlySet<any>
    ? never
    : TState
  : never;

type AnyStateHandle<TState = any, TEvents extends EventTypes = any> = {
  /** Read the current immutable base state. This read is tracked. */
  get: () => Immutable<TState>;
  /** Read the current immutable base state snapshot without tracking. */
  peek: () => Immutable<TState>;
  /** Replace the base state, or update it with an Immer producer. */
  set: (value: TState | Producer<TState>) => void;
  /**
   * Emit a custom event with zero or one argument.
   */
  emit: [TEvents] extends [{}]
    ? <TEvent extends string & keyof TEvents>(
        name: TEvent,
        ...args: TEvents[TEvent]
      ) => void
    : never;
};

type InferLenses<TState> =
  OnlyPlainObject<TState> extends infer T
    ? [T] extends [never]
      ? {}
      : { readonly [K in keyof T]: Lens<T[K]> }
    : {};

type InferState<TProps extends object> = {} & Immutable<{
  [K in keyof FilterProperties<
    TProps,
    ReadonlySignal | AnyStateHandle | Lens
  >]: TProps[K] extends
    | ReadonlySignal<infer T>
    | AnyStateHandle<infer T>
    | Lens<infer T>
    ? T
    : never;
}> &
  Readonly<InferManagedStates<TProps>>;

type AnyManagedState<TState = any, TEvents extends EventTypes = any> = {
  /** Get the underlying signal for an exposed signal or base-state property. */
  get<K extends keyof TState>(key: K): ReadonlySignal<TState[K]>;
  get(): ReadonlySignal<TState>;
  /** Read the current immutable public state snapshot without tracking. */
  peek<K extends keyof TState>(key: K): TState[K];
  peek(): TState;
  /** Subscribe to future immutable state snapshots. Returns a function to unsubscribe. */
  subscribe<K extends keyof TState>(
    key: K,
    listener: (value: TState[K]) => void,
  ): () => void;
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
  TEvents extends EventTypes = EventTypes,
  TProps extends object = Record<string, unknown>,
> = AnyManagedState<TState, TEvents> & Immutable<TState> & TProps;

const queryMethods = new WeakSet<(...args: any[]) => any>();

/**
 * Mark a constructor-returned method as a tracked query.
 *
 * Query methods wrap their body in `computed()`, so reads inside the method
 * participate in signal tracking even after the method is exposed publicly.
 * Tagged query methods also skip the default `action()` wrapping step.
 */
export function query<TFunction extends (...args: any[]) => any>(
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
 * same way as `StateHandle.get()`.
 */
export type Lens<TState = any> = {
  /** Read the current immutable property value. This read is tracked. */
  get: () => Immutable<TState>;
  /** Replace the property value, or update it with an Immer producer. */
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
 * `Lens` for each top-level property key.
 *
 * For ordinary derived values, prefer external functions like
 * `getVisibleTodos(state)` so unused helpers can be tree-shaken. Reach for
 * `computed(() => derive(handle.get()))` only when you need memoized reactive
 * reads as a performance optimization.
 */
export type StateHandle<
  TState,
  TEvents extends EventTypes = never,
> = AnyStateHandle<TState, TEvents> & InferLenses<TState>;

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
  TEvents extends EventTypes,
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
    | AnyStateHandle;
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
 * reads are tracked by the `@preact/signals` runtime.
 *
 * Events can carry at most one argument.
 *
 * The state constructor should be side-effect free.
 */
export function defineManagedState<
  TState,
  TEvents extends EventTypes,
  TParams extends any[],
  TProps extends object = {},
  TInitialState = TState,
>(
  constructor: StateConstructor<TState, TEvents, TParams, TProps>,
  initialState: TInitialState,
) {
  initialState = freeze(initialState);

  return class extends StateContainer {
    constructor(...params: TParams) {
      const state = signal(initialState as Immutable<TState>);
      const handle = createStateHandle<TState, TEvents>(state, (name, detail) =>
        this.dispatchEvent(new CustomEvent(name, { detail })),
      );

      const props = constructor(handle, ...params);
      super(state, handle, props);
    }
  } as unknown as new (
    ...params: TParams
  ) => ManagedState<InferState<TProps>, TEvents, InferPublicProps<TProps>>;
}

/** @internal */
class StateContainer extends EventTarget {
  private readonly _signals = new Map<string, ReadonlySignal>();
  private readonly _view = computed(() => ({ ...this }));

  constructor(state: Signal, handle: AnyStateHandle, props: any) {
    super();
    const propDescriptors = Object.getOwnPropertyDescriptors(props);
    for (const key in propDescriptors) {
      const propDescriptor = propDescriptors[key];
      if ("value" in propDescriptor) {
        let { value } = propDescriptor;
        if (typeof value === "function") {
          Object.defineProperty(this, key, {
            value: queryMethods.has(value) ? value : action(value),
          });
          continue;
        }
        const signal = getExposedSignal(value, state, handle);
        if (signal) {
          this._signals.set(key, signal);
          Object.defineProperty(this, key, {
            get: () => signal.value,
            enumerable: true,
          });
        } else if (isManagedState(value)) {
          Object.defineProperty(this, key, {
            value,
            enumerable: true,
          });
        } else {
          throw new Error(
            `Invalid property: ${key}. Must be a function, a signal, a top-level lens, the state handle, or a managed state.`,
          );
        }
      } else {
        throw new Error(`\`get ${key}() {}\` syntax is forbidden`);
      }
    }
  }
  get(key?: string) {
    if (!key) {
      return this._view;
    }
    return this._signals.get(key);
  }
  peek(key?: string) {
    const signal = this.get(key);
    if (!signal) {
      return undefined;
    }
    return signal.peek();
  }
  subscribe(
    ...args:
      | [listener: (value: any) => void]
      | [key: string, listener: (value: any) => void]
  ) {
    if (args.length > 1) {
      const [key, listener] = args as [string, (value: any) => void];
      const signal = this.get(key);
      if (!signal) {
        throw new Error(`Property ${key} is not a signal`);
      }
      return signal.subscribe(listener);
    }
    return this._view.subscribe(args[0] as (value: any) => void);
  }
  on(name: string, listener: (...args: any[]) => void) {
    const adapter: EventListener = (event: Event) => {
      const detail = (event as CustomEvent).detail;
      if (detail === undefined) {
        listener();
      } else {
        listener(detail);
      }
    };
    this.addEventListener(name, adapter);
    return () => {
      this.removeEventListener(name, adapter);
    };
  }
}

function isProducer<T>(value: T | Producer<T>): value is Producer<T> {
  return typeof value === "function";
}

function makeNonEnumerable(object: object, keys: string[]) {
  for (const key of keys)
    Object.defineProperty(object, key, {
      ...Object.getOwnPropertyDescriptor(object, key),
      enumerable: false,
    });
}

const lensKeys = new WeakMap<object, PropertyKey>();

function createStateHandle<TState, TEvents extends EventTypes>(
  state: Signal<Immutable<TState>>,
  emit: (name: string, detail?: any) => any,
): StateHandle<TState, TEvents> {
  const handle: AnyStateHandle<TState, TEvents> = {
    get: () => state.value,
    peek: () => state.peek(),
    set: (update) => {
      state.value = isProducer(update)
        ? produce(state.value, update)
        : castImmutable(update);
    },
    emit: emit as any,
  };

  // Hide methods to allow spreading the handle into the public state object.
  makeNonEnumerable(handle, Object.keys(handle));

  const lenses = new Map<PropertyKey, Lens>();
  const getLensDescriptor = (key: PropertyKey) => {
    const currentState = state.value;
    if (!isLensableState(currentState)) {
      return undefined;
    }
    return Reflect.getOwnPropertyDescriptor(currentState, key);
  };
  const getLens = (key: PropertyKey) => {
    let lens = lenses.get(key);
    if (!lens) {
      lens = {
        get: () => (handle.get() as any)[key],
        set: (update) => {
          handle.set((draft: any) => {
            draft[key] = isProducer(update)
              ? produce(draft[key], update)
              : update;
          });
        },
      };
      lensKeys.set(lens, key);
      lenses.set(key, lens);
    }
    return lens;
  };

  return new Proxy(handle, {
    get(target, key, receiver) {
      if (Reflect.has(target, key)) {
        return Reflect.get(target, key, receiver);
      }
      if (!getLensDescriptor(key)) {
        return undefined;
      }
      return getLens(key);
    },
    // For spreading the state handle, we only expose the lens keys.
    ownKeys(_target) {
      const currentState = state.value;
      if (!isLensableState(currentState)) {
        return [];
      }
      return Reflect.ownKeys(currentState);
    },
    getOwnPropertyDescriptor(_target, key) {
      const lensDescriptor = getLensDescriptor(key);
      if (!lensDescriptor) {
        return undefined;
      }
      return {
        configurable: true,
        enumerable: lensDescriptor.enumerable,
        value: getLens(key),
        writable: false,
      };
    },
  }) as StateHandle<TState, TEvents>;
}

function isLensableState(
  value: unknown,
): value is Record<PropertyKey, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function getExposedSignal(
  value: unknown,
  state: Signal,
  handle: AnyStateHandle,
): ReadonlySignal | undefined {
  if (value === handle) {
    return state;
  }
  if (value instanceof Signal) {
    return value;
  }
  const lensKey = getLensKey(value);
  if (lensKey !== undefined) {
    return computed(
      () => (state.value as Record<PropertyKey, unknown>)[lensKey],
    );
  }
}

function getLensKey(value: unknown): PropertyKey | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }
  return lensKeys.get(value);
}

/**
 * Clean encapsulation of complex UI state.
 *
 * Use this when a component needs the same managed-state API without defining a
 * separate class. The constructor follows the same rules as
 * `defineManagedState()`, including explicit typing of the `StateHandle`
 * parameter for state and event inference.
 */
export function useManagedState<
  TState,
  TEvents extends EventTypes,
  TProps extends object = {},
  TInitialState = TState,
>(
  constructor: StateConstructor<TState, TEvents, [], TProps>,
  initialState: TInitialState | (() => TInitialState),
): ManagedState<InferState<TProps>, TEvents, InferPublicProps<TProps>> {
  return useState(
    () =>
      new (defineManagedState(
        constructor,
        isFunction(initialState) ? initialState() : initialState,
      ))(),
  )[0];
}

function isFunction(value: unknown): value is (...args: any[]) => any {
  return typeof value === "function";
}

/**
 * Any subscribable source, including a managed state or any Preact signal.
 */
export type SubscribeTarget<T> = {
  subscribe: (listener: (value: T) => void) => () => void;
};

/**
 * Subscribe to future values from a subscribable source inside `useEffect`.
 *
 * The listener is kept fresh automatically, so a dependency array is not part
 * of this API. Pass `null` to disable the subscription temporarily.
 */
export function useSubscribe<T>(
  target: SubscribeTarget<T> | null,
  listener: (value: T) => void,
): void {
  listener = useStableCallback(listener);
  useEffect(() => target?.subscribe(listener), [target]);
}

type InferEvent<T extends EventTarget | AnyManagedState> =
  T extends AnyManagedState<{}, infer TEvents extends EventTypes>
    ? string & keyof TEvents
    : T extends { addEventListener: (name: infer TEvent) => any }
      ? string & TEvent
      : string;

type InferEventListener<
  T extends EventTarget | AnyManagedState,
  TEvent extends string = any,
> =
  T extends AnyManagedState<{}, infer TEvents extends EventTypes>
    ? TEvent extends string & keyof TEvents
      ? (...args: TEvents[TEvent]) => void
      : never
    : T extends {
          addEventListener: (
            name: TEvent,
            listener: infer TListener extends (event: any) => any,
          ) => any;
        }
      ? TListener
      : (event: Event) => void;

/**
 * Subscribe to events from an `EventTarget` or managed state inside `useEffect`.
 *
 * The listener is kept fresh automatically, so a dependency array is not part
 * of this API. Pass `null` to disable the subscription temporarily.
 *
 * For managed-state events, your listener receives the emitted argument
 * directly, or no argument at all.
 */
export function useEventTarget<
  T extends EventTarget | AnyManagedState,
  TEvent extends InferEvent<T>,
>(
  target: T | null,
  name: TEvent,
  listener: InferEventListener<T, TEvent>,
): void {
  listener = useStableCallback(listener) as typeof listener;
  useEffect(() => {
    if (!target) return;
    if (isManagedState(target)) {
      return target.on(name, listener);
    }
    target.addEventListener(name, listener);
    return () => target.removeEventListener(name, listener);
  }, [target, name]);
}

function useStableCallback<TParams extends any[], TResult>(
  callback: (...params: TParams) => TResult,
) {
  const ref = useRef(callback);
  ref.current = callback;

  return useCallback((...params: TParams) => (0, ref.current)(...params), []);
}

/** Check whether a value is a managed-state instance. */
export function isManagedState(value: unknown): value is AnyManagedState {
  return value instanceof StateContainer;
}
