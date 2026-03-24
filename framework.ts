import {
  action,
  computed,
  ReadonlySignal,
  Signal,
  signal,
  untracked,
} from "@preact/signals";
import { castImmutable, freeze, Immutable, produce, Producer } from "immer";
import { useCallback, useEffect, useRef, useState } from "preact/hooks";

// Don't re-export the entire API; only the most essential parts.
export { untracked, batch } from "@preact/signals";

const $events = Symbol("events");

type EventTypes = Record<string, [any?]>;

type FilterProperties<T extends object, U> = {} & {
  [P in {
    [K in keyof T]: [T[K]] extends [never] ? never : T[K] extends U ? K : never;
  }[keyof T]]: T[P];
};

type InferActions<TProps extends object> = {} & FilterProperties<
  TProps,
  () => any
>;

type InferState<TProps extends object> = {} & {
  [K in keyof FilterProperties<
    TProps,
    ReadonlySignal<any> | StateHandle<any>
  >]: TProps[K] extends ReadonlySignal<infer T> | StateHandle<infer T>
    ? T
    : never;
};

interface State<TState = any, TEvents extends EventTypes = EventTypes> {
  /** @internal */
  [$events]: TEvents;
  /** Get the underlying signal for an exposed signal or base-state property. */
  get<K extends keyof TState>(key: K): ReadonlySignal<Immutable<TState[K]>>;
  /** Read the current immutable public state without tracking. */
  peek(): Immutable<TState>;
  /** Subscribe to future immutable state snapshots. Returns a function to unsubscribe. */
  subscribe(listener: (value: Immutable<TState>) => void): () => void;
  /**
   * Subscribe to a custom event emitted by this managed state.
   *
   * Your listener receives the emitted argument directly, or no argument at all.
   * The argument is never wrapped in an array.
   */
  on<TEvent extends string & keyof TEvents>(
    name: TEvent,
    listener: (...args: TEvents[TEvent]) => void,
  ): () => void;
}

/**
 * Public instance shape produced by `defineManagedState()` and `useManagedState()`.
 *
 * Returned signals are exposed as tracked getter properties. Returning the
 * `StateHandle` itself exposes the base state directly as an immutable property.
 */
export type ManagedState<
  TState = any,
  TEvents extends EventTypes = EventTypes,
  TProps extends object = {},
> = State<TState, TEvents> & Immutable<TState> & TProps;

/**
 * Constructor-local access to the base state.
 *
 * `TState` may be any non-function value, including primitives. If the base
 * state is object-shaped, name the handle like an instance such as `counter`.
 * Otherwise prefer a specific non-generic name instead of `state`, `handle`,
 * or `value`.
 *
 * Return this handle from the constructor only when you want to expose the base
 * state directly as an immutable property. It is not intended as a composition
 * primitive between managed states.
 */
export type StateHandle<TState, TEvents extends EventTypes = never> = {
  /** Read the current immutable base state without tracking. */
  get: () => Immutable<TState>;
  /** Replace the base state, or update it with an Immer producer. */
  set: (value: TState | Producer<TState>) => void;
  /**
   * Emit a domain-specific event with zero or one argument.
   *
   * Prefer event names that describe meaningful domain happenings. For reactive
   * responses to state changes, prefer `effect()` from `@preact/signals` over a
   * generic `"changed"` event.
   */
  emit: [TEvents] extends [{}]
    ? <TEvent extends string & keyof TEvents>(
        name: TEvent,
        ...args: TEvents[TEvent]
      ) => void
    : never;

  /** Derive a tracked signal from the base state. */
  select: <U>(selector: (value: Immutable<TState>) => U) => ReadonlySignal<U>;
};

/**
 * Pure constructor function for a managed state definition.
 *
 * Return only methods, signals, or the provided `StateHandle`. Returned signals
 * become tracked getter properties, and returning the handle exposes the base
 * state directly as an immutable property.
 */
export type StateConstructor<
  TState,
  TEvents extends EventTypes,
  TParams extends any[],
  TProps extends object = {},
> = (
  handle: StateHandle<TState, TEvents>,
  ...params: TParams
) => TProps &
  Record<string, StateHandle<any> | ReadonlySignal<any> | (() => any)>;

/**
 * Define a managed state class with a private mutable implementation and an
 * immutable public surface.
 *
 * `TState` may be any non-function value, including primitives.
 *
 * Methods are automatically wrapped with `action()` from `@preact/signals`, so
 * they are untracked and batched. Public actions should usually close over the
 * provided handle instead of relying on `this`, which means they typically do
 * not need defensive binding or wrapping when passed around.
 *
 * The state constructor must return an object with properties that are either:
 * - A function (to expose methods)
 * - A signal (to expose derived state)
 * - The state handle (to expose the immutable base state directly)
 *
 * Returned signals are turned into getter properties, so reads are tracked by
 * the `@preact/signals` runtime.
 *
 * Use custom events for domain-specific notifications only. Events can carry at
 * most one argument; use an object literal when you need to send multiple
 * pieces of data.
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
      const handle: StateHandle<TState, TEvents> = {
        get: () => state.value,
        set: (update) => {
          state.value = isProducer(update)
            ? produce(state.value, update)
            : castImmutable(update);
        },
        // @ts-expect-error
        emit: (name, detail) => {
          this.dispatchEvent(new CustomEvent(name, { detail }));
        },
      };

      const props = constructor(handle, ...params);
      super(state, handle, props);
    }
  } as unknown as new (
    ...params: TParams
  ) => ManagedState<InferState<TProps>, TEvents, InferActions<TProps>>;
}

/** @internal */
class StateContainer extends EventTarget {
  private readonly _state: Signal;
  private readonly _handle: StateHandle<any>;
  private readonly _props: any;
  private readonly _view = computed(() => ({ ...this }));

  constructor(state: Signal, handle: StateHandle<any>, props: any) {
    super();
    this._state = state;
    this._handle = handle;
    this._props = props;

    const propDescriptors = Object.getOwnPropertyDescriptors(props);
    for (const key in propDescriptors) {
      const propDescriptor = propDescriptors[key];
      if ("value" in propDescriptor) {
        let { value } = propDescriptor;
        if (typeof value === "function") {
          Object.defineProperty(this, key, {
            value: action(value),
          });
          continue;
        }
        if (value === handle) {
          value = state;
        }
        if (value instanceof Signal) {
          Object.defineProperty(this, key, {
            get: () => value.value,
            enumerable: true,
          });
        } else {
          throw new Error(
            `Invalid property: ${key}. Must be a function, a signal, or the state handle.`,
          );
        }
      } else {
        throw new Error(`\`get ${key}() {}\` syntax is forbidden`);
      }
    }
  }
  get(key: string) {
    const prop = this._props[key];
    return prop instanceof Signal
      ? prop
      : prop === this._handle
        ? this._state
        : undefined;
  }
  peek() {
    return this._view.peek();
  }
  subscribe(listener: (value: any) => void) {
    return this._view.subscribe(listener);
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

/**
 * Clean encapsulation of complex UI state.
 *
 * Use this when a component needs the same managed-state API without defining a
 * separate class. The constructor follows the same rules as
 * `defineManagedState()`: return only methods, signals, or the `StateHandle`,
 * and keep it side-effect free.
 */
export function useManagedState<
  TState,
  TEvents extends EventTypes,
  TProps extends object = {},
  TInitialState = TState,
>(
  constructor: StateConstructor<TState, TEvents, [], TProps>,
  initialState: TInitialState,
): ManagedState<InferState<TProps>, TEvents, InferActions<TProps>> {
  return useState(
    () => new (defineManagedState(constructor, initialState))(),
  )[0];
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

type InferEvent<T extends EventTarget | ManagedState> =
  T extends ManagedState<any, infer TEvents>
    ? string & keyof TEvents
    : T extends { addEventListener: (name: infer TEvent) => any }
      ? string & TEvent
      : string;

type InferEventListener<
  T extends EventTarget | ManagedState,
  TEvent extends string = any,
> =
  T extends ManagedState<{}, infer TEvents>
    ? (...args: TEvents[TEvent]) => void
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
 * directly, or no argument at all, never an array wrapper.
 */
export function useEventTarget<
  T extends EventTarget | State,
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
      return target.on(name, listener as any);
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
export function isManagedState(value: unknown): value is State {
  return value instanceof StateContainer;
}
