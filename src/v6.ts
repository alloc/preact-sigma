import {
  action,
  batch,
  computed,
  signal as createSignal,
  ReadonlySignal,
  Signal,
} from "@preact/signals";
import { RefObject } from "preact";
import { useEffect, useRef } from "preact/hooks";
import { AnyResource } from "./framework";
import * as immer from "./immer";
import { EventParameters, SigmaListenerMap } from "./listener";

type Cleanup = () => void;

let autoFreezeEnabled = true;

export function setAutoFreeze(autoFreeze: boolean) {
  immer.setAutoFreeze(autoFreeze);
  autoFreezeEnabled = autoFreeze;
}

const signalSuffix = "$";
const instanceSymbol = Symbol("instance");
const subscriptionCache = new WeakMap<Sigma<any>, Set<Function>>();
const patchesEnabledCache = new WeakSet<Function>();
const initializationCache = new WeakSet<Function>();
const queries = new WeakSet<Function>();

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

function getStateSignal(instance: Sigma<any>, key: string) {
  return (instance as any)[key + signalSuffix] as Signal<any> | undefined;
}

function isStateKey(instance: Sigma<any>, key: string): boolean {
  return Object.hasOwn(instance, key + signalSuffix);
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
          activeDraft = immer.createDraft({ ...instance });
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
        activeDraft ??= immer.createDraft({ ...instance });
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

function castArrayIfExists<T>(value: Iterable<T> | undefined) {
  return value ? [...value] : undefined;
}

function ensureDraftCommitted(instance: Sigma<any>) {
  if (activeInstance && instance !== activeInstance) {
    throw new Error("Draft was not committed before an external action was invoked.");
  }
  if (!activeDraft) {
    activeInstance = null;
    return false;
  }

  const draft = activeDraft;
  activeDraft = null;

  const subscriptions = castArrayIfExists(subscriptionCache.get(instance));
  activeInstance = null;

  const patchesEnabled = subscriptions
    ? [...subscriptions].some((subscription) => patchesEnabledCache.has(subscription))
    : false;

  let patches: immer.Patch[] | undefined;
  let inversePatches: immer.Patch[] | undefined;
  let patchListener: immer.PatchListener | undefined;
  if (patchesEnabled) {
    patchListener = (nextPatches, nextInversePatches) => {
      patches = nextPatches;
      inversePatches = nextInversePatches;
    };
  }

  const baseState = immer.original(draft);
  const nextState = immer.finishDraft(draft, patchListener);
  const changed = baseState !== nextState;

  if (changed) {
    batch(() => {
      for (const key in nextState) {
        const nextValue = nextState[key];
        if (autoFreezeEnabled) {
          immer.freeze(nextValue, true);
        }
        const signal = (instance as any)[key + signalSuffix] as Signal<any>;
        signal.value = nextValue;
      }
    });

    subscriptions?.forEach((subscription) =>
      subscription(nextState, baseState, patches, inversePatches),
    );
  }

  return changed;
}

function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
  return value != null && typeof (value as PromiseLike<unknown>).then === "function";
}

function initializePrototype(prototype: object) {
  const descriptors = Object.getOwnPropertyDescriptors(prototype);
  for (const key in descriptors) {
    const { get, value } = descriptors[key];

    // Computeds
    if (get) {
      descriptors[key].get = function () {
        const signal = ((this as any)[key + signalSuffix] ??= computed(get.bind(this)));
        return signal.value;
      };
    }

    // Actions
    else if (typeof value === "function" && key !== "constructor" && !queries.has(value)) {
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
  } else if (resource instanceof AbortController) {
    resource.abort();
  } else if ("dispose" in resource) {
    resource.dispose();
  } else {
    resource[Symbol.dispose]();
  }
}

const emptySentinel: any = {};
const typeSymbol = Symbol("type");

function act(this: Sigma<any>, fn: (this: typeof this) => void) {
  const instance = getActionInstance(this);
  if (instance !== this) {
    throw new Error("Cannot act() from inside an action.");
  }
  ensureActiveInstance(instance);
  activeDraft = immer.createDraft({ ...instance });
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

export abstract class Sigma<TState extends object> {
  declare [typeSymbol]: TState;

  get [instanceSymbol]() {
    return this;
  }

  constructor(initialState: TState) {
    if (!initializationCache.has(this.constructor)) {
      initializePrototype(this.constructor.prototype);
      initializationCache.add(this.constructor);
    }
    if (initialState === emptySentinel) {
      return; // SigmaTarget without
    }
    for (const key in initialState) {
      const initialValue = initialState[key];
      if (autoFreezeEnabled) {
        immer.freeze(initialValue, true);
      }
      Object.defineProperty(this, key + signalSuffix, {
        value: createSignal(initialValue),
      });
      if (!Object.hasOwn(this.constructor.prototype, key)) {
        Object.defineProperty(this.constructor.prototype, key, {
          get() {
            return (this as any)[key + signalSuffix].value;
          },
          enumerable: true,
        });
      }
    }
  }

  onSetup?(...args: any[]): readonly AnyResource[];

  setup(...args: Parameters<Extract<this["onSetup"], AnyFunction>>) {
    const setupContext = new Proxy(this, {
      get(target, key, receiver) {
        if (key === instanceSymbol) {
          return target;
        }
        if (key === "act") {
          return act;
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

  protect(): Protected<this> {
    return this as any;
  }

  commit<T = void>(callback?: (this: typeof this) => T) {
    const instance = getActionInstance(this);
    if (instance === this) {
      throw new Error("Cannot commit() from outside an action.");
    }
    ensureDraftCommitted(instance);
    return callback?.call(instance as this);
  }

  // oxlint-disable-next-line no-unused-vars
  act(fn: (this: typeof this) => void) {
    throw new Error("Cannot act() from outside an onSetup() context.");
  }
}

export class SigmaTarget<TState extends object = {}, TEvents = {}> extends Sigma<TState> {
  #listeners = new SigmaListenerMap();

  constructor(state?: TState) {
    super(state ?? emptySentinel);
  }

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
    this.#listeners.emit(name, detail);
  }
}

export const sigma = /* @__PURE__ */ Object.freeze({
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
      patchesEnabledCache.add(listener);
    }

    let subscriptions = subscriptionCache.get(instance);
    if (!subscriptions) {
      subscriptions = new Set();
      subscriptionCache.set(instance, subscriptions);
    }
    subscriptions.add(listener);
    return () => {
      subscriptions.delete(listener);
      if (!subscriptions.size) {
        subscriptionCache.delete(instance);
      }
    };
  }) as {
    <TState extends object>(
      instance: Sigma<TState>,
      listener: (
        nextState: Protected<TState>,
        baseState: Protected<TState>,
        patches: immer.Patch[],
        inversePatches: immer.Patch[],
      ) => void,
      options: { patches: true },
    ): Cleanup;

    <TState extends object>(
      instance: Sigma<TState>,
      listener: (
        nextState: Protected<TState>,
        baseState: Protected<TState>,
        patches: immer.Patch[] | undefined,
        inversePatches: immer.Patch[] | undefined,
      ) => void,
      options: { patches: boolean },
    ): Cleanup;

    <TState extends object>(
      instance: Sigma<TState>,
      listener: (nextState: Protected<TState>, baseState: Protected<TState>) => void,
    ): Cleanup;

    <TState extends object>(
      instance: Sigma<TState>,
      key: Extract<keyof TState, string>,
      listener: (value: Protected<TState[typeof key]>) => void,
    ): Cleanup;
  },

  getSignal<TState extends object>(
    instance: Sigma<TState>,
    key: Extract<keyof TState, string>,
  ): ReadonlySignal<Protected<TState[typeof key]>> {
    return getStateSignal(instance, key)!;
  },

  getState<TState extends object>(instance: Sigma<TState>): Protected<TState> {
    return { ...instance } as any;
  },

  replaceState<TState extends object>(target: Sigma<TState>, nextState: Protected<TState>) {
    const instance = getActionInstance(target);
    instance.act(function () {
      Object.assign(this, nextState);
    });
  },
});

type AnyFunction = (...args: any[]) => any;

function query(method: AnyFunction, context: ClassMethodDecoratorContext<any, any>) {
  queries.add(method);
  function queryMethod(this: any, ...args: any[]) {
    return computed(() => method.apply(this, args)).value;
  }
  context.addInitializer(function () {
    this[context.name] = queryMethod;
  });
}

const depsCache = new WeakMap<RefObject<any>, readonly any[] | undefined>();

function depsChanged<T>(container: RefObject<T | null>, deps?: readonly any[]) {
  const cachedDeps = depsCache.get(container);
  if (!deps && !cachedDeps) {
    return true;
  }
  if (
    deps &&
    cachedDeps &&
    (deps.length !== cachedDeps.length ||
      deps.some((dep, index) => !Object.is(dep, cachedDeps[index])))
  ) {
    return true;
  }
  return false;
}

const protectedKeys = ["emit", "commit", "act", "protect", "onSetup"] as const;

type ProtectedKey = typeof typeSymbol | (typeof protectedKeys)[number];

const protectedSymbol = Symbol("protected");

type BrandProtected<T> = T & { [protectedSymbol]: true };

export type Protected<T> = BrandProtected<
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

export type UseSigmaOptions<TSetup extends readonly any[] = any[]> = {
  setup: TSetup | (() => TSetup);
  deps?: readonly any[];
};

const isArray = Array.isArray as (value: unknown) => value is readonly any[];

export type UseSigmaArgs<T extends Sigma<any>> = T extends {
  onSetup: (...params: infer TParams) => any;
}
  ? [] extends TParams
    ? [create: () => T, options?: Partial<UseSigmaOptions<TParams>>]
    : [create: () => T, options: UseSigmaOptions<TParams>]
  : [create: () => T, deps?: readonly any[]];

export function useSigma<T extends Sigma<any>>(...args: UseSigmaArgs<T>): Protected<T>;
export function useSigma<T extends Sigma<any>>(
  create: () => T,
  optionsOrDeps?: Partial<UseSigmaOptions> | readonly any[],
) {
  // HACK: avoid useMemo so that HMR doesn't recreate the instance
  const container = useRef<Protected<T> | null>(null);

  let setup: Partial<UseSigmaOptions>["setup"];
  let deps: readonly any[] | undefined;

  if (isArray(optionsOrDeps)) {
    deps = optionsOrDeps;
  } else {
    setup = optionsOrDeps?.setup;
    deps = optionsOrDeps?.deps;
  }

  if (!container.current || depsChanged(container, deps)) {
    depsCache.set(container, deps);
    container.current = create().protect();
  }

  const instance = container.current;

  const setupDeps = isArray(setup) ? setup : [];
  useEffect(() => {
    if (Object.hasOwn(instance.constructor.prototype, "onSetup")) {
      const setupArgs: any = setup ? (isArray(setup) ? setup : setup()) : [];
      return instance.setup(...setupArgs);
    }
  }, [instance, ...setupDeps]);

  return instance;
}

type Todo<T> = {
  status: "pending" | "completed";
  title: string;
  data: T;
};

type TodoListState<T> = {
  todos: Todo<T>[];
};

type TodoListEvents<T> = {
  added: Todo<T>;
};

// Extend SigmaTarget if events are needed, otherwise extend Sigma.
// oxlint-disable-next-line typescript/no-unsafe-declaration-merging
export class TodoList<T> extends SigmaTarget<TodoListState<T>, TodoListEvents<T>> {
  // Private, ephemeral, mutable state (untracked)
  #foo = {};

  // Default state is defined in the constructor
  constructor() {
    super({ todos: [] });
  }

  // Computeds (tracked, memoized, readonly)
  get completedTodos() {
    return this.todos.filter((todo) => todo.status === "completed");
  }

  // Queries (tracked, half-memoized, readonly)
  @query findTodoBy(predicate: (todo: Todo<T>) => boolean) {
    return this.todos.find(predicate);
  }

  // Actions (untracked, mutation allowed)
  addTodo(title: string, data: T) {
    this.todos.push({ status: "pending", title, data });
    this.commit(function () {
      // Emit from inside the commit callback for access to immutable state.
      this.emit("added", this.todos[this.todos.length - 1]);
    });
  }
}

// Sadly, we need this to make the state public.
export interface TodoList<T> extends TodoListState<T> {}
