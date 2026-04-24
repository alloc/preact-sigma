import {
  action,
  batch,
  computed,
  signal as createSignal,
  ReadonlySignal,
  Signal,
} from "@preact/signals";
import * as immer from "./immer.js";
import { type EventParameters, SigmaListenerMap } from "./internal/listener.js";
import {
  instanceSymbol,
  listenersSymbol,
  refSymbol,
  snapshotSymbol,
  typeSymbol,
} from "./internal/symbols.js";
import {
  type AnyFunction,
  type AnyResource,
  type Cleanup,
  isPlainObject,
  isPromiseLike,
} from "./internal/utils.js";

let autoFreezeEnabled = true;

/**
 * Configures Immer auto-freezing for values published through sigma state.
 *
 * Auto-freezing is enabled by default, so draftable public values are deeply frozen after publish.
 */
export function setAutoFreeze(autoFreeze: boolean) {
  immer.setAutoFreeze(autoFreeze);
  autoFreezeEnabled = autoFreeze;
}

const signalSuffix = "$";
const changeListenersMap = new WeakMap<Sigma<any>, Set<Function>>();
const patchListeners = new WeakSet<Function>();
const initializedTypes = new WeakSet<Function>();
const queries = new WeakSet<Function>();
const emptySentinel: any = {};

/** Marks object values that should keep their reference-like type in `Draft` and `Immutable` mappings. */
export type SigmaRef<T extends object = {}> = T & {
  [refSymbol]?: true;
};

/** Definition shape used by helper types that need both state and event maps. */
export type SigmaDefinition = {
  state: object;
  events?: object;
};

/** Instance type for a sigma definition with state typing preserved for public helpers. */
export type SigmaState<T extends SigmaDefinition> = Sigma<T["state"]> & {
  [typeSymbol]: T;
};

let activeInstance: Sigma<any> | null = null;
let activeDraft: any;

function ensureActiveInstance(instance: Sigma<any>) {
  if (!activeInstance) {
    activeInstance = instance;
    return false;
  }
  if (instance !== activeInstance) {
    throw new Error("Draft was not committed before an external action was invoked.");
  }
  return true;
}

function clearActiveInstance() {
  activeInstance = null;
  activeDraft = null;
}

function isStateKey(instance: Sigma<any>, key: string): boolean {
  return Object.hasOwn(instance, key + signalSuffix);
}

function getStateSignal(instance: Sigma<any>, key: string) {
  return (instance as any)[key + signalSuffix] as Signal<any> | undefined;
}

function createSnapshot(instance: Sigma<any>) {
  if (instance[snapshotSymbol]) {
    return instance[snapshotSymbol];
  }
  const state: Record<string, unknown> = {};
  for (const key in instance) {
    if (isStateKey(instance, key)) {
      state[key] = (instance as any)[key];
    }
  }
  return state;
}

function createDraft<TState extends object>(instance: Sigma<TState>): immer.Draft<TState> {
  return immer.createDraft(createSnapshot(instance)) as any;
}

function hasPatchListeners(instance: Sigma<any>) {
  const listeners = changeListenersMap.get(instance);
  if (!listeners) {
    return false;
  }
  for (const sub of listeners) {
    if (patchListeners.has(sub)) {
      return true;
    }
  }
  return false;
}

function publishState(
  instance: Sigma<any>,
  nextState: Record<string, unknown>,
  baseState: Record<string, unknown>,
  patches?: immer.Patch[],
  inversePatches?: immer.Patch[],
) {
  instance[snapshotSymbol] = nextState;
  batch(() => {
    const missingKeys = new Set(Object.keys(baseState));
    for (const key in nextState) {
      const nextValue = nextState[key];
      if (autoFreezeEnabled) {
        immer.freeze(nextValue, true);
      }
      const signal = getStateSignal(instance, key);
      if (signal) {
        signal.value = nextValue;
      } else {
        defineSignalProperty(instance, key, nextValue);
      }
      missingKeys.delete(key);
    }
    for (const key of missingKeys) {
      const signal = getStateSignal(instance, key);
      if (signal) {
        signal.value = undefined;
      }
    }
  });

  const changeListeners = changeListenersMap.get(instance);
  changeListeners?.forEach((listener) => {
    listener(nextState, baseState, patches, inversePatches);
  });
}

function createActionContext<TState extends object>(instance: Sigma<TState>) {
  return new Proxy(instance, {
    get(target, key, receiver) {
      if (typeof key === "string" && isStateKey(target, key)) {
        if (activeDraft) {
          ensureActiveInstance(target);
          return activeDraft[key];
        }
        const { value } = getStateSignal(target, key)!;
        if (immer.isDraftable(value)) {
          activeDraft = createDraft(instance);
          return activeDraft[key];
        }
        return value;
      }
      if (key === instanceSymbol) {
        return instance;
      }
      return Reflect.get(target, key, receiver);
    },
    set(target, key, value) {
      if (typeof key === "string" && isStateKey(target, key)) {
        ensureActiveInstance(instance);
        activeDraft ??= createDraft(instance);
        activeDraft[key] = value;
        return true;
      }
      return Reflect.set(target, key, value);
    },
  });
}

function getActionInstance(context: object) {
  return (context as { [instanceSymbol]: Sigma<any> })[instanceSymbol];
}

function ensureDraftCommitted(instance: Sigma<any>) {
  if (activeInstance && instance !== activeInstance) {
    throw new Error("Draft was not committed before an external action was invoked.");
  }

  activeInstance = null;
  if (!activeDraft) {
    return false;
  }

  const draft = activeDraft;
  activeDraft = null;

  let patches: immer.Patch[] | undefined;
  let inversePatches: immer.Patch[] | undefined;
  let patchListener: immer.PatchListener | undefined;

  if (hasPatchListeners(instance)) {
    patchListener = (nextPatches, nextInversePatches) => {
      patches = nextPatches;
      inversePatches = nextInversePatches;
    };
  }

  const baseState = immer.original(draft);
  const nextState = immer.finishDraft(draft, patchListener);
  const changed = baseState !== nextState;

  if (changed) {
    publishState(instance, nextState, baseState, patches, inversePatches);
  }

  return changed;
}

function initializePrototype(prototype: object) {
  const descriptors = Object.getOwnPropertyDescriptors(prototype);
  for (const key in descriptors) {
    if (key === "constructor" || key === "onSetup") {
      continue;
    }

    const { get, value } = descriptors[key];

    // Computeds
    if (get) {
      descriptors[key].get = function () {
        if (activeDraft) {
          return get.call(this);
        }
        const instance = getActionInstance(this);
        const signal = ((instance as any)[key + signalSuffix] ??= computed(get.bind(instance)));
        return signal.value;
      };
    }

    // Actions
    else if (typeof value === "function" && !queries.has(value)) {
      const actionFn = action(value);

      descriptors[key].value = function (this: object, ...args: any[]) {
        const instance = getActionInstance(this);
        const actionExisted = ensureActiveInstance(instance);
        if (actionExisted) {
          return value.apply(this, args);
        }

        let result;
        try {
          const actionContext = createActionContext(instance);
          result = actionFn.apply(actionContext, args);
        } catch (error) {
          clearActiveInstance();
          throw error;
        }

        const changed = ensureDraftCommitted(instance);
        if (isPromiseLike(result)) {
          if (changed) {
            throw new Error(
              `[preact-sigma] Action named "${key}" forgot to commit() its draft before returning a promise.`,
            );
          }
          const onResolveAsyncAction = (promiseResult: any) => {
            if (activeDraft && instance === activeInstance) {
              const changed = ensureDraftCommitted(instance);
              if (changed) {
                throw new Error(
                  `[preact-sigma] Action named "${key}" forgot to commit() its draft before its promise resolved.`,
                );
              }
            }
            return promiseResult;
          };
          return result.then(onResolveAsyncAction);
        }

        return result;
      };
    }
  }
  Object.defineProperties(prototype, descriptors);
}

function disposeCleanupResource(resource: AnyResource) {
  if (typeof resource === "function") {
    resource();
  } else if ("dispose" in resource) {
    resource.dispose();
  } else {
    resource[Symbol.dispose]();
  }
}

function act(this: Sigma<any>, fn: (this: any) => void) {
  const instance = getActionInstance(this);
  if (instance !== this) {
    throw new Error("Cannot act() from inside an action.");
  }
  ensureActiveInstance(instance);
  activeDraft = createDraft(instance);
  try {
    const context = createActionContext(instance);
    const result = action(fn).call(context);
    if (isPromiseLike(result)) {
      throw new Error("[preact-sigma] act() callbacks must be synchronous");
    }
  } catch (error) {
    clearActiveInstance();
    throw error;
  }
  ensureDraftCommitted(instance);
}

function defineSignalProperty(instance: Sigma<any>, key: string, value: any) {
  Object.defineProperty(instance, key + signalSuffix, {
    value: createSignal(value),
  });
  if (!Object.hasOwn(instance.constructor.prototype, key)) {
    Object.defineProperty(instance.constructor.prototype, key, {
      get() {
        return this[key + signalSuffix].value;
      },
      enumerable: true,
    });
  }
}

/**
 * Base class for signal-backed state models.
 *
 * `TState` is the source of typing for top-level state keys, subscriptions, signals, and replacement snapshots.
 * Merge a same-named interface with the class when direct property reads should be typed on the instance.
 */
export abstract class Sigma<TState extends object> {
  declare [typeSymbol]: { state: TState; events: unknown };
  declare [snapshotSymbol]: Record<string, unknown> | undefined;

  protected get [instanceSymbol]() {
    return this;
  }

  constructor(initialState: TState) {
    if (!initializedTypes.has(this.constructor)) {
      initializePrototype(this.constructor.prototype);
      initializedTypes.add(this.constructor);
    }
    if (initialState === emptySentinel) {
      return; // SigmaTarget without any state
    }
    for (const key in initialState) {
      const initialValue = initialState[key];
      if (autoFreezeEnabled) {
        immer.freeze(initialValue, true);
      }
      defineSignalProperty(this, key, initialValue);
    }
  }

  /** Optional setup hook that owns side effects and returns cleanup resources. */
  onSetup?(...args: any[]): readonly AnyResource[];

  /** Runs `onSetup(...)` and returns a cleanup that disposes returned resources in reverse order. */
  setup(...args: Parameters<Extract<this["onSetup"], AnyFunction>>) {
    const setupContext = new Proxy(this, {
      get(target, key, receiver) {
        if (key === instanceSymbol) {
          return target;
        }
        if (key === "act") {
          return act.bind(target);
        }
        return Reflect.get(target, key, receiver);
      },
    });
    const resources = this.onSetup!.apply(setupContext, args);
    return () => {
      for (let i = resources.length - 1; i >= 0; i--) {
        disposeCleanupResource(resources[i]);
      }
    };
  }

  /** Returns a readonly consumer view that hides lifecycle and event-emitter internals. */
  protect(): Protected<this> {
    return this as any;
  }

  /**
   * Publishes the current action draft.
   *
   * Use this before unpublished changes cross an async, event, or external-action boundary.
   * A callback runs after publish in an action context.
   */
  commit<T = void>(callback?: (this: typeof this) => T) {
    const instance = getActionInstance(this);
    if (instance === this) {
      throw new Error("Cannot commit() from outside an action.");
    }
    ensureDraftCommitted(instance);
    if (callback) {
      const context = new Proxy(instance, {
        get(target, key, receiver) {
          if (key === instanceSymbol) {
            return instance;
          }
          return Reflect.get(target, key, receiver);
        },
      });
      return callback.call(context as this);
    }
  }

  /** Runs a synchronous setup-owned callback with action semantics from an `onSetup(...)` context. */
  // oxlint-disable-next-line no-unused-vars
  act(fn: (this: typeof this) => void) {
    throw new Error("Cannot act() from outside an onSetup() context.");
  }
}

/**
 * Sigma state model that can emit typed events.
 *
 * `TEvents` maps event names to payload types, and `TState` types reactive state.
 */
export class SigmaTarget<
  TEvents extends object = {},
  TState extends object = {},
> extends Sigma<TState> {
  declare [typeSymbol]: { state: TState; events: TEvents };
  protected [listenersSymbol] = new SigmaListenerMap();

  constructor(state?: TState) {
    super(state ?? emptySentinel);
  }

  /** Emits a typed event from an action after unpublished draft changes are committed. */
  emit<TEvent extends string & keyof TEvents>(
    name: TEvent,
    ...[detail]: EventParameters<TEvents[TEvent]>
  ) {
    const instance = getActionInstance(this);
    if (instance === this) {
      throw new Error("Cannot emit() from outside an action.");
    }
    if (instance === activeInstance && activeDraft) {
      throw new Error("Cannot emit() until you commit() your draft.");
    }
    this[listenersSymbol].emit(name, detail);
  }
}

/** Helpers for observing, accessing, capturing, and replacing committed sigma state. */
export const sigma = /* @__PURE__ */ Object.freeze({
  /** Subscribes to committed state publishes or to one signal-backed top-level state key. */
  subscribe: ((
    instance: Sigma<any>,
    keyOrListener: string | AnyFunction,
    listenerOrOptions?: AnyFunction | { patches: boolean },
  ) => {
    if (typeof keyOrListener === "string") {
      const signal = getStateSignal(instance, keyOrListener);
      if (!signal) {
        throw new Error(`[preact-sigma] Property named "${keyOrListener}" is not signal-backed.`);
      }
      return signal.subscribe(listenerOrOptions as AnyFunction);
    }

    const listener = keyOrListener;
    const options = listenerOrOptions as { patches: boolean } | undefined;

    if (options?.patches) {
      patchListeners.add(listener);
    }

    let subscriptions = changeListenersMap.get(instance);
    if (!subscriptions) {
      subscriptions = new Set();
      changeListenersMap.set(instance, subscriptions);
    }
    subscriptions.add(listener);
    return () => {
      subscriptions.delete(listener);
      if (!subscriptions.size) {
        changeListenersMap.delete(instance);
      }
    };
  }) as {
    <TState extends object>(
      instance: Sigma<TState>,
      listener: (
        nextState: immer.Immutable<TState>,
        baseState: immer.Immutable<TState>,
        patches: immer.Patch[],
        inversePatches: immer.Patch[],
      ) => void,
      options: { patches: true },
    ): Cleanup;

    <TState extends object>(
      instance: Sigma<TState>,
      listener: (
        nextState: immer.Immutable<TState>,
        baseState: immer.Immutable<TState>,
        patches: immer.Patch[] | undefined,
        inversePatches: immer.Patch[] | undefined,
      ) => void,
      options: { patches: boolean },
    ): Cleanup;

    <TState extends object>(
      instance: Sigma<TState>,
      listener: (nextState: immer.Immutable<TState>, baseState: immer.Immutable<TState>) => void,
    ): Cleanup;

    <TState extends object, TKey extends Extract<keyof TState, string>>(
      instance: Sigma<TState>,
      key: TKey,
      listener: (value: immer.Immutable<TState[TKey]>) => void,
    ): Cleanup;
  },

  /** Returns the readonly signal backing one top-level state key. */
  getSignal<TState extends object, TKey extends Extract<keyof TState, string>>(
    instance: Sigma<TState>,
    key: TKey,
  ): ReadonlySignal<immer.Immutable<TState[TKey]>> {
    return getStateSignal(instance, key)!;
  },

  /** Captures the current committed top-level state snapshot. */
  captureState<TState extends object>(instance: Sigma<TState>): immer.Immutable<TState> {
    return Object.freeze(createSnapshot(instance)) as any;
  },

  /** Publishes a plain-object snapshot as the current committed state. */
  replaceState<TState extends object>(target: Sigma<TState>, nextState: TState) {
    if (!isPlainObject(nextState)) {
      throw new Error("[preact-sigma] replaceState() requires a plain object snapshot");
    }
    if (activeDraft) {
      throw new Error(
        `[preact-sigma] replaceState() cannot run while an action has unpublished changes.`,
      );
    }

    const instance = getActionInstance(target);
    const baseState = createSnapshot(instance);
    const patches = hasPatchListeners(instance) ? [] : undefined;
    const inversePatches = patches ? [] : undefined;

    publishState(instance, nextState, baseState, patches, inversePatches);
  },
});

/** Marks a class method as a reactive read with arguments instead of an action. */
export function query(method: AnyFunction, context: ClassMethodDecoratorContext<any, any>) {
  queries.add(method);
  function queryMethod(this: any, ...args: any[]) {
    return computed(() => method.apply(this, args)).value;
  }
  context.addInitializer(function () {
    this[context.name] = queryMethod;
  });
}

declare const protectedSymbol: unique symbol;

// Keys hidden by the Protected type.
type ProtectedKey =
  | typeof typeSymbol
  | typeof snapshotSymbol
  | "act"
  | "commit"
  | "emit"
  | "onSetup"
  | "protect";

// This makes it less likely for Protected<T> to be erased by the type system.
type BrandProtected<T> = T & { [protectedSymbol]: true };

/** Readonly public view returned by `protect(...)` and `useSigma(...)`. */
export type Protected<T extends Sigma<any>> = BrandProtected<
  T extends { [typeSymbol]: infer TState }
    ? {
        [K in Exclude<keyof T, ProtectedKey>]: K extends keyof TState
          ? // Reactive state
            immer.Immutable<T[K]>
          : T[K] extends AnyFunction
            ? // Actions and queries
              (...params: Parameters<T[K]>) => immer.Immutable<ReturnType<T[K]>>
            : // Computeds
              immer.Immutable<T[K]>;
      }
    : never
>;
