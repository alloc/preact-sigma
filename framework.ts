import { Signal, signal } from "@preact/signals";
import { castImmutable, Immutable, produce, Producer } from "immer";
import { useState } from "preact/hooks";

type State<TKey extends string, TValue> = {
  readonly [StateKey in TKey]: Immutable<TValue>;
};

const $events = Symbol("events");

type EventTypes = Record<string, [any?]>;

export type StateManager<
  TState extends object,
  TEvents extends EventTypes,
  TMethods extends object,
> = TState & {
  /** @internal */
  [$events]: TEvents;
  /** Access the current state without reactivity. */
  peek(): Immutable<TState[keyof TState]>;
  /** Subscribe to state changes. Returns a function to unsubscribe. */
  subscribe(listener: (value: TState[keyof TState]) => void): () => void;
  /** Subscribe to an event. Returns a function to unsubscribe. */
  on<TEvent extends string & keyof TEvents>(
    name: TEvent,
    listener: (detail: TEvents[TEvent]) => void,
  ): () => void;
} & TMethods;

export type StateHandle<T, TEvents extends EventTypes> = {
  get: () => Immutable<T>;
  set: (value: T | Producer<T>) => void;
  emit: [TEvents] extends [{}]
    ? <TEvent extends string & keyof TEvents>(
        name: TEvent,
        ...args: TEvents[TEvent]
      ) => void
    : never;
};

const subscriptions = new WeakMap<object, Record<string, Set<Function>>>();

export type StateConstructor<
  TValue,
  TEvents extends EventTypes,
  TParams extends any[],
  TMethods extends object = {},
> = (
  handle: StateHandle<TValue, TEvents>,
  ...params: TParams
) => {
  initialValue: Immutable<TValue>;
  methods: TMethods;
};

export function defineState<
  TKey extends string,
  TValue,
  TEvents extends EventTypes,
  TParams extends any[],
  TMethods extends object = {},
>(
  key: TKey,
  constructor: StateConstructor<TValue, TEvents, TParams, TMethods>,
) {
  return (
    ...params: TParams
  ): StateManager<State<TKey, TValue>, TEvents, TMethods> => {
    const handle: StateHandle<TValue, TEvents> = {
      get: () => state.value,
      set: (update) => {
        state.value = isProducer(update)
          ? produce(state.value, update)
          : castImmutable(update);
      },
      // @ts-expect-error
      emit: (name, detail) => {
        const subscribersByEvent = subscriptions.get(container);
        const subscribers = subscribersByEvent?.[name];
        subscribers?.forEach((subscriber) => subscriber(detail));
      },
    };

    const { initialValue, methods } = constructor(handle, ...params);
    const state = signal<Immutable<TValue>>(initialValue);
    const container = new StateContainer(key, state, methods);
    return container as any;
  };
}

class StateContainer {
  constructor(
    key: string,
    private readonly state: Signal,
    methods: object,
  ) {
    Object.assign(this, methods);
    Object.defineProperty(this, key, {
      get: () => this.state.value,
    });
  }
  peek() {
    return this.state.value;
  }
  subscribe(listener: (value: any) => void) {
    return this.state.subscribe(listener);
  }
  on(name: string, listener: (detail: any) => void) {
    let subscribers = subscriptions.get(this);
    if (subscribers) {
      subscribers[name] ||= new Set();
      subscribers[name].add(listener);
    } else {
      subscribers = { [name]: new Set([listener]) };
      subscriptions.set(this, subscribers);
    }
    return () => {
      subscribers[name].delete(listener);
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
  TValue,
  TEvents extends EventTypes,
  TMethods extends object = {},
>(
  constructor: StateConstructor<TValue, TEvents, [], TMethods>,
): StateManager<State<"value", TValue>, TEvents, TMethods> {
  return useState(() => defineState("value", constructor)())[0];
}
