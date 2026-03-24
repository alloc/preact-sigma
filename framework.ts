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
  /** Get the underlying signal for a property. */
  get<K extends keyof TState>(key: K): ReadonlySignal<Immutable<TState[K]>>;
  /** Access the current state without reactivity. */
  peek(): Immutable<TState>;
  /** Subscribe to state changes. Returns a function to unsubscribe. */
  subscribe(listener: (value: Immutable<TState>) => void): () => void;
  /** Subscribe to an event. Returns a function to unsubscribe. */
  on<TEvent extends string & keyof TEvents>(
    name: TEvent,
    listener: (detail: TEvents[TEvent]) => void,
  ): () => void;
}

export type ManagedState<
  TState = any,
  TEvents extends EventTypes = EventTypes,
  TProps extends object = {},
> = State<TState, TEvents> & Immutable<TState> & TProps;

/** Used by the state constructor to inspect, mutate, and derive state and emit events. */
export type StateHandle<TState, TEvents extends EventTypes = never> = {
  get: () => Immutable<TState>;
  set: (value: TState | Producer<TState>) => void;
  emit: [TEvents] extends [{}]
    ? <TEvent extends string & keyof TEvents>(
        name: TEvent,
        ...args: TEvents[TEvent]
      ) => void
    : never;

  /** Derive state from the base state. */
  select: <U>(selector: (value: Immutable<TState>) => U) => ReadonlySignal<U>;
};

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
 * Define an encapsulated state constructor. Nothing outside the constructor can
 * modify the state, except through its returned methods.
 *
 * **Important: The state type MUST NOT be a function.**
 *
 * Methods are automatically wrapped with `action()` (from `@preact/signals`) to
 * ensure they're untracked and batched.
 *
 * The state constructor must return an object with properties that are either:
 * - A function (to expose methods)
 * - A signal (to expose derived state)
 * - The state handle (to expose the base state)
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
  on(name: string, listener: (detail: any) => void) {
    const adapter: EventListener = (event: Event) =>
      listener((event as CustomEvent).detail);
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
 * Use this when your component's local state is complex (more than a simple primitive value, or
 * more than a few state transitions). Don't use this if a single `useState()` is enough. Don't use
 * this for local state that is unrelated to each other conceptually.
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

export type SubscribeTarget<T> = {
  subscribe: (listener: (value: T) => void) => () => void;
};

/**
 * Subscribe to future changes from a signal or state manager.
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
 * Subscribe to events from an event target or state manager.
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

export function isManagedState(value: unknown): value is State {
  return value instanceof StateContainer;
}
