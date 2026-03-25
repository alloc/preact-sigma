import { action, computed, type ReadonlySignal, Signal } from "@preact/signals";
import { castImmutable, produce, type Immutable, type Producer } from "immer";

import type { AnyManagedState, EventTypes, Lens, StateHandle } from "./framework.ts";

type Cleanup = () => void;
type Disposable = {
  [Symbol.dispose](): void;
};
type OwnedResource = Cleanup | Disposable;
type OwnedResources = OwnedResource | readonly OwnedResource[];

const lensKeys = new WeakMap<object, PropertyKey>();

export const queryMethods = new WeakSet<(...args: any[]) => any>();

export class StateContainer extends EventTarget {
  private readonly _signals = new Map<string, ReadonlySignal>();
  private readonly _view = computed(() => ({ ...this }));

  constructor(
    state: Signal,
    handle: AnyStateHandle,
    props: any,
    readonly dispose: () => void,
  ) {
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
    ...args: [listener: (value: any) => void] | [key: string, listener: (value: any) => void]
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

  [Symbol.dispose]() {
    this.dispose();
  }
}

function isProducer<T>(value: T | Producer<T>): value is Producer<T> {
  return typeof value === "function";
}

function makeNonEnumerable(object: object, keys: string[]) {
  for (const key of keys) {
    Object.defineProperty(object, key, {
      ...Object.getOwnPropertyDescriptor(object, key),
      enumerable: false,
    });
  }
}

export class AnyStateHandle<TState = any, TEvents extends EventTypes = any> {
  constructor(
    private readonly state: Signal<Immutable<TState>>,
    /**
     * Emit a custom event with zero or one argument.
     */
    readonly emit: [TEvents] extends [{}]
      ? <TEvent extends string & keyof TEvents>(name: TEvent, ...args: TEvents[TEvent]) => void
      : never,
    /**
     * Attach cleanup functions or disposables to the managed state instance.
     */
    readonly own: (resources: OwnedResources) => void,
  ) {
    // Hide non-inherited methods to allow spreading the handle into the public
    // state object.
    makeNonEnumerable(this, ["emit", "own"]);
  }

  /** Read the current immutable base state. This read is tracked. */
  get(): Immutable<TState> {
    return this.state.value;
  }

  /** Read the current immutable base state snapshot without tracking. */
  peek(): Immutable<TState> {
    return this.state.peek();
  }

  /** Replace the base state, or update it with an Immer producer. */
  set(value: TState | Producer<TState>) {
    this.state.value = isProducer(value) ? produce(this.state.value, value) : castImmutable(value);
  }
}

export function createStateHandle<TState, TEvents extends EventTypes>(
  state: Signal<Immutable<TState>>,
  emit: (name: string, detail?: any) => any,
  own: (resources: OwnedResources) => void,
): StateHandle<TState, TEvents> {
  const handle = new AnyStateHandle<TState, TEvents>(
    state,
    emit as unknown as AnyStateHandle<TState, TEvents>["emit"],
    own,
  );

  let lenses: Map<PropertyKey, Lens> | undefined;

  const getLensDescriptor = (key: PropertyKey) => {
    const currentState = state.value;
    if (!isLensableState(currentState)) {
      return undefined;
    }
    return Reflect.getOwnPropertyDescriptor(currentState, key);
  };
  const getLens = (key: PropertyKey) => {
    let lens = (lenses ||= new Map<PropertyKey, Lens>()).get(key);
    if (!lens) {
      lens = {
        get: () => (handle.get() as any)[key],
        set: (update) => {
          handle.set((draft: any) => {
            draft[key] = isProducer(update) ? produce(draft[key], update) : update;
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

function isLensableState(value: unknown): value is Record<PropertyKey, unknown> {
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
    return computed(() => (state.value as Record<PropertyKey, unknown>)[lensKey]);
  }
}

function getLensKey(value: unknown): PropertyKey | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }
  return lensKeys.get(value);
}

export function disposeOwnedResources(resources: readonly OwnedResource[]) {
  let errors: unknown[] | undefined;
  for (let index = resources.length - 1; index >= 0; index -= 1) {
    try {
      const resource = resources[index];
      if (typeof resource === "function") {
        resource();
      } else {
        resource[Symbol.dispose]();
      }
    } catch (error) {
      errors ||= [];
      errors.push(error);
    }
  }
  if (errors) {
    throw new AggregateError(errors, "Failed to dispose one or more resources");
  }
}

/** Check whether a value is a managed-state instance. */
export function isManagedState(value: unknown): value is AnyManagedState {
  return value instanceof StateContainer;
}
