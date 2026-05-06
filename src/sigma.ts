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
const initializedPrototypes = new WeakSet<object>();
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

let activeActionInstance: Sigma<any> | null = null;
let activeDraftInstance: Sigma<any> | null = null;
let activeDraft: any;
let activeDerivedReadDepth = 0;
let activeSetupInstance: Sigma<any> | null = null;
const pendingAsyncActions = new WeakMap<Sigma<any>, number>();

function hasPendingAsyncAction(instance: Sigma<any>) {
  return pendingAsyncActions.has(instance);
}

function addPendingAsyncAction(instance: Sigma<any>) {
  pendingAsyncActions.set(instance, (pendingAsyncActions.get(instance) ?? 0) + 1);
}

function removePendingAsyncAction(instance: Sigma<any>) {
  const count = pendingAsyncActions.get(instance);
  if (!count) {
    return;
  }
  if (count === 1) {
    pendingAsyncActions.delete(instance);
  } else {
    pendingAsyncActions.set(instance, count - 1);
  }
}

function hasActionContext(instance: Sigma<any>) {
  if (activeActionInstance) {
    return activeActionInstance === instance;
  }
  return hasPendingAsyncAction(instance);
}

function createExternalActionError() {
  const instance = activeDraftInstance ?? activeActionInstance;
  const constructorName = instance?.constructor.name;
  const owner = constructorName ? `Draft for ${constructorName}` : "Draft";
  return new Error(
    `[preact-sigma] ${owner} was not committed before an external action was invoked.`,
  );
}

function beginActionContext(instance: Sigma<any>) {
  if (!activeActionInstance) {
    if (activeDraftInstance && activeDraftInstance !== instance) {
      throw createExternalActionError();
    }
    activeActionInstance = instance;
    return false;
  }
  if (instance !== activeActionInstance) {
    throw createExternalActionError();
  }
  return true;
}

function endActionContext(instance: Sigma<any>) {
  if (activeActionInstance === instance) {
    activeActionInstance = null;
  }
}

function clearActiveAction() {
  activeActionInstance = null;
  activeDraftInstance = null;
  activeDraft = null;
}

function assertActionContext(instance: Sigma<any>, message: string) {
  if (activeActionInstance && activeActionInstance !== instance) {
    throw createExternalActionError();
  }
  if (!hasActionContext(instance)) {
    throw new Error(message);
  }
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
      state[key] = getStateSignal(instance, key)!.value;
    }
  }
  return state;
}

function createDraft<TState extends object>(instance: Sigma<TState>): immer.Draft<TState> {
  return immer.createDraft(createSnapshot(instance)) as any;
}

function ensureDraft(instance: Sigma<any>) {
  if (activeDraftInstance && activeDraftInstance !== instance) {
    throw createExternalActionError();
  }
  activeDraftInstance = instance;
  activeDraft ??= createDraft(instance);
  return activeDraft;
}

function readStateProperty(instance: Sigma<any>, key: string) {
  const signal = getStateSignal(instance, key)!;
  if (!activeDerivedReadDepth && hasActionContext(instance)) {
    if (activeDraftInstance === instance) {
      return activeDraft[key];
    }
    if (immer.isDraftable(signal.value)) {
      return ensureDraft(instance)[key];
    }
  }
  return signal.value;
}

function writeStateProperty(instance: Sigma<any>, key: string, value: unknown) {
  assertActionContext(
    instance,
    `[preact-sigma] Cannot set state property "${key}" outside an action.`,
  );
  ensureDraft(instance)[key] = value;
}

function runDerivedRead<T>(callback: () => T): T {
  activeDerivedReadDepth += 1;
  try {
    return callback();
  } finally {
    activeDerivedReadDepth -= 1;
  }
}

function assertActionResult(key: string, result: any) {
  if (immer.isDraft(result)) {
    throw new Error(`[preact-sigma] Action named "${key}" returned an active draft.`);
  }
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

function getActionInstance(context: object) {
  return (context as { [instanceSymbol]: Sigma<any> })[instanceSymbol];
}

function commitDraft(instance: Sigma<any>) {
  if (activeDraftInstance && instance !== activeDraftInstance) {
    throw createExternalActionError();
  }

  if (!activeDraft) {
    return false;
  }

  const draft = activeDraft;
  activeDraft = null;
  activeDraftInstance = null;

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

function hasStateChanges(baseState: Record<string, unknown>, nextState: Record<string, unknown>) {
  const baseKeys = Object.keys(baseState);
  const nextKeys = Object.keys(nextState);
  if (baseKeys.length !== nextKeys.length) {
    return true;
  }
  for (const key of nextKeys) {
    if (!Object.hasOwn(baseState, key) || !Object.is(baseState[key], nextState[key])) {
      return true;
    }
  }
  return false;
}

function createReplacementPatches(
  baseState: Record<string, unknown>,
  nextState: Record<string, unknown>,
) {
  let patches: immer.Patch[] | undefined;
  let inversePatches: immer.Patch[] | undefined;
  const draft = immer.createDraft(baseState) as Record<string, unknown>;
  const missingKeys = new Set(Object.keys(baseState));

  for (const key in nextState) {
    draft[key] = nextState[key];
    missingKeys.delete(key);
  }
  for (const key of missingKeys) {
    delete draft[key];
  }

  immer.finishDraft(draft, (nextPatches, nextInversePatches) => {
    patches = nextPatches;
    inversePatches = nextInversePatches;
  });

  return { inversePatches, patches };
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
        const instance = getActionInstance(this);
        const signal = ((instance as any)[key + signalSuffix] ??= computed(() =>
          runDerivedRead(() => get.call(instance)),
        ));
        return signal.value;
      };
    }

    // Actions
    else if (typeof value === "function" && !queries.has(value)) {
      const actionFn = action(value);

      descriptors[key].value = function (this: object, ...args: any[]) {
        if (activeDerivedReadDepth) {
          throw new Error("[preact-sigma] Computeds and queries cannot call actions.");
        }

        const instance = getActionInstance(this);
        const actionExisted = beginActionContext(instance);
        if (actionExisted) {
          const result = value.apply(instance, args);
          assertActionResult(key, result);
          return result;
        }

        let result;
        try {
          result = actionFn.apply(instance, args);
          assertActionResult(key, result);
        } catch (error) {
          clearActiveAction();
          throw error;
        }

        let changed;
        try {
          changed = commitDraft(instance);
        } catch (error) {
          clearActiveAction();
          throw error;
        }
        if (isPromiseLike(result)) {
          if (changed) {
            endActionContext(instance);
            throw new Error(
              `[preact-sigma] Action named "${key}" forgot to commit() its draft before returning a promise.`,
            );
          }
          addPendingAsyncAction(instance);
          endActionContext(instance);
          const onResolveAsyncAction = (promiseResult: any) => {
            try {
              if (activeDraft && instance === activeDraftInstance) {
                const changed = commitDraft(instance);
                if (changed) {
                  throw new Error(
                    `[preact-sigma] Action named "${key}" forgot to commit() its draft before its promise resolved.`,
                  );
                }
              }
              return promiseResult;
            } finally {
              removePendingAsyncAction(instance);
            }
          };
          const onRejectAsyncAction = (error: unknown) => {
            if (activeDraftInstance === instance) {
              activeDraft = null;
              activeDraftInstance = null;
            }
            removePendingAsyncAction(instance);
            throw error;
          };
          return result.then(onResolveAsyncAction, onRejectAsyncAction);
        }

        endActionContext(instance);
        return result;
      };
    }
  }
  Object.defineProperties(prototype, descriptors);
}

function initializeType(type: Function) {
  for (
    let prototype = type.prototype;
    prototype && prototype !== Sigma.prototype && prototype !== SigmaTarget.prototype;
    prototype = Object.getPrototypeOf(prototype)
  ) {
    if (initializedPrototypes.has(prototype)) {
      break;
    }
    initializePrototype(prototype);
    initializedPrototypes.add(prototype);
  }
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

function defineSignalProperty(instance: Sigma<any>, key: string, value: any) {
  Object.defineProperty(instance, key + signalSuffix, {
    value: createSignal(value),
  });
  if (!Object.hasOwn(instance.constructor.prototype, key)) {
    Object.defineProperty(instance.constructor.prototype, key, {
      get() {
        return readStateProperty(this, key);
      },
      set(value) {
        writeStateProperty(this, key, value);
      },
      enumerable: true,
    });
  }
}

/**
 * Base class for signal-backed state models.
 *
 * `TState` is the source of typing for top-level state keys, subscriptions, signals, and replacement snapshots.
 * The initial state passed to `super(...)` can use either the mutable `TState` shape or an immutable snapshot.
 * Private class fields stay ordinary instance storage and are not signal-backed, captured,
 * persisted, or used for reactive invalidation by themselves.
 * Merge a same-named interface with the class when direct property reads should be typed on the instance.
 */
export abstract class Sigma<TState extends object> {
  declare [typeSymbol]: { state: TState; events: unknown };
  declare [snapshotSymbol]: Record<string, unknown> | undefined;

  protected get [instanceSymbol]() {
    return this;
  }

  constructor(initialState: TState | immer.Immutable<TState>) {
    initializeType(this.constructor);
    if (initialState === emptySentinel) {
      return; // SigmaTarget without any state
    }
    const state = initialState as Record<string, unknown>;
    for (const key in state) {
      const initialValue = state[key];
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
    const instance = getActionInstance(this);
    const previousSetupInstance = activeSetupInstance;
    activeSetupInstance = instance;
    let resources: readonly AnyResource[];
    try {
      resources = this.onSetup!.apply(instance, args);
    } finally {
      activeSetupInstance = previousSetupInstance;
    }
    return () => {
      for (let i = resources.length - 1; i >= 0; i--) {
        disposeCleanupResource(resources[i]);
      }
    };
  }

  /**
   * Publishes the current action draft.
   *
   * Use this before unpublished changes cross an async, event, or external-action boundary.
   * A callback runs after publish in an action context.
   */
  commit<T = void>(callback?: (this: typeof this) => T) {
    const instance = getActionInstance(this);
    assertActionContext(instance, "Cannot commit() from outside an action.");
    commitDraft(instance);
    if (callback) {
      return callback.call(instance as this);
    }
  }

  /** Runs a synchronous setup-owned callback with action semantics from an `onSetup(...)` context. */
  act(fn: (this: typeof this) => void) {
    const instance = getActionInstance(this);
    if (activeSetupInstance !== instance) {
      throw new Error("Cannot act() from outside an onSetup() context.");
    }
    if (activeActionInstance === instance) {
      throw new Error("Cannot act() from inside an action.");
    }
    beginActionContext(instance);
    try {
      const result = action(fn).call(instance as this);
      if (isPromiseLike(result)) {
        throw new Error("[preact-sigma] act() callbacks must be synchronous");
      }
      commitDraft(instance);
    } catch (error) {
      clearActiveAction();
      throw error;
    }
    endActionContext(instance);
  }
}

/** Casts a sigma instance to its readonly public consumer view. */
export function castProtected<T extends Sigma<any>>(instance: T): Protected<T> {
  return instance as any;
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

  constructor(state?: TState | immer.Immutable<TState>) {
    super(state ?? emptySentinel);
  }

  /**
   * Emits a typed event.
   *
   * Directly constructed targets can emit from ordinary code. Subclasses emit from action context
   * after unpublished draft changes are committed.
   */
  emit<TEvent extends string & keyof TEvents>(
    name: TEvent,
    ...[detail]: EventParameters<TEvents[TEvent]>
  ) {
    const instance = getActionInstance(this);
    if (Object.getPrototypeOf(instance) === SigmaTarget.prototype) {
      if (activeDraft) {
        throw createExternalActionError();
      }
    } else {
      assertActionContext(instance, "Cannot emit() from outside an action.");
    }
    if (instance === activeDraftInstance && activeDraft) {
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

  /** Publishes a plain-object snapshot, including readonly captured snapshots, as committed state. */
  replaceState<TState extends object>(
    target: Sigma<TState>,
    nextState: TState | immer.Immutable<TState>,
  ) {
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
    const replacement = nextState as Record<string, unknown>;
    if (!hasStateChanges(baseState, replacement)) {
      return;
    }
    const { inversePatches, patches } = hasPatchListeners(instance)
      ? createReplacementPatches(baseState, replacement)
      : { inversePatches: undefined, patches: undefined };

    publishState(instance, replacement, baseState, patches, inversePatches);
  },
});

/**
 * Marks a class method as a committed-state reactive read with arguments instead of an action.
 *
 * Each call creates a reactive read at the call site. Query calls do not memoize results across invocations.
 */
export function query<TThis extends object, TArgs extends any[], TReturn>(
  method: (this: TThis, ...args: TArgs) => TReturn,
): (this: TThis, ...args: TArgs) => TReturn {
  queries.add(method);
  function queryMethod(this: TThis, ...args: TArgs) {
    const instance = getActionInstance(this);
    return computed(() => runDerivedRead(() => method.apply(instance as TThis, args))).value;
  }
  queries.add(queryMethod);
  return queryMethod;
}

declare const protectedSymbol: unique symbol;

// Keys hidden by the Protected type.
type ProtectedKey =
  | typeof listenersSymbol
  | typeof snapshotSymbol
  | "act"
  | "commit"
  | "emit"
  | "onSetup";

// This makes it less likely for Protected<T> to be erased by the type system.
type BrandProtected<T> = T & { [protectedSymbol]: true };

/** Readonly public view returned by `castProtected(...)` and `useSigma(...)`. */
export type Protected<T extends Sigma<any>> = BrandProtected<
  T extends { [typeSymbol]: { state: infer TState extends object } }
    ? {
        // Mapping over `keyof T` preserves TypeScript definition links for protected members.
        readonly [K in keyof T as K extends ProtectedKey ? never : K]: K extends typeof typeSymbol
          ? T[K]
          : K extends keyof TState
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
