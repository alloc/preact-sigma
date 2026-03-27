import { computed, type ReadonlySignal, Signal, signal } from "@preact/signals";
import { createDraft, finishDraft, freeze, isDraftable, type Patch } from "immer";
import { Draft, Immutable } from "./immer";

export { action, computed, effect } from "@preact/signals";

type AnyFunction = (...args: any[]) => any;

const signalPrefix = "#";

const sigmaStateBrand = Symbol("sigma.v2.state");
const sigmaEventsBrand = Symbol("sigma.v2.events");
const sigmaRefBrand = Symbol("sigma.v2.ref");

type Cleanup = () => void;
type Disposable = {
  [Symbol.dispose](): void;
};

export type AnyEvents = Record<string, object | void>;
export type AnyState = Record<string, unknown>;

type DefaultStateInitializer<TValue> = (this: void) => TValue;

type DefaultStateValue<TValue> = TValue | DefaultStateInitializer<TValue>;

export type AnyDefaultState<TState extends AnyState> = {
  [K in keyof TState]?: DefaultStateValue<TState[K]>;
};

export type AnyResource = Cleanup | Disposable | AbortController;

export type SigmaRef<T extends object = object> = T & {
  readonly [sigmaRefBrand]: true;
};

type ComputedValues<TComputeds extends object | undefined> = [undefined] extends [TComputeds]
  ? never
  : {
      readonly [K in keyof TComputeds]: TComputeds[K] extends AnyFunction
        ? Immutable<ReturnType<TComputeds[K]>>
        : never;
    };

type ComputedContext<TState extends AnyState, TComputeds extends object> = Immutable<TState> &
  ComputedValues<TComputeds>;

type QueryMethods<TQueries extends object | undefined> = [undefined] extends [TQueries]
  ? never
  : {
      [K in keyof TQueries]: TQueries[K] extends AnyFunction
        ? (...args: Parameters<TQueries[K]>) => ReturnType<TQueries[K]>
        : never;
    };

type ActionMethods<TActions extends object | undefined> = [undefined] extends [TActions]
  ? never
  : {
      [K in keyof TActions]: TActions[K] extends AnyFunction
        ? (...args: Parameters<TActions[K]>) => ReturnType<TActions[K]>
        : never;
    };

type EventMethods<TEvents extends AnyEvents | undefined> = [undefined] extends [TEvents]
  ? never
  : {
      readonly [sigmaEventsBrand]: TEvents;
      on<TEvent extends string & keyof TEvents>(
        name: TEvent,
        listener: [TEvents[TEvent]] extends [void]
          ? () => void
          : (payload: TEvents[TEvent]) => void,
      ): Cleanup;
    };

type SetupMethods<TSetupArgs extends any[] | undefined> = [TSetupArgs] extends [undefined]
  ? never
  : {
      setup(...args: Extract<TSetupArgs, any[]>): Cleanup;
    };

type ReadonlyContext<
  TState extends AnyState,
  TComputeds extends object,
  TQueries extends object,
> = Immutable<TState> & ComputedValues<TComputeds> & QueryMethods<TQueries>;

type Emit<TEvents extends AnyEvents> = <TEvent extends string & keyof TEvents>(
  name: TEvent,
  ...args: [TEvents[TEvent]] extends [void] ? [] : [payload: TEvents[TEvent]]
) => void;

type ActionContext<
  TState extends AnyState,
  TEvents extends AnyEvents,
  TComputeds extends object,
  TQueries extends object,
  TActions extends object,
> = Draft<TState> &
  ComputedValues<TComputeds> &
  QueryMethods<TQueries> &
  ActionMethods<TActions> & {
    emit: Emit<TEvents>;
  };

type SetupContext<T extends SigmaDefinition> = SigmaState<T> & {
  emit: T["events"] extends object ? Emit<T["events"]> : never;
};

type Simplify<T extends object> = {} & {
  [K in keyof T]: T[K];
};

type MergeObjects<TLeft extends object, TRight> = [TRight] extends [object]
  ? Extract<Simplify<Omit<TLeft, keyof TRight> & TRight>, TLeft>
  : TLeft;

type RequiredKeys<TObject extends object> = {
  [K in keyof TObject]-?: {} extends Pick<TObject, K> ? never : K;
}[keyof TObject];

type MissingInitialKeys<
  TState extends AnyState,
  TDefaults extends AnyDefaultState<TState> | undefined,
> = Exclude<RequiredKeys<TState>, keyof NonNullable<TDefaults>>;

type InitialStateInput<
  TState extends AnyState,
  TDefaults extends AnyDefaultState<TState> | undefined,
> = [MissingInitialKeys<TState, TDefaults>] extends [never]
  ? [initialState?: Partial<TState>]
  : [initialState: Pick<TState, MissingInitialKeys<TState, TDefaults>> & Partial<TState>];

export type AnySigmaState = EventTarget & {
  readonly [sigmaStateBrand]: true;
};

export type AnySigmaStateWithEvents<TEvents extends AnyEvents> = AnySigmaState & {
  readonly [sigmaEventsBrand]: TEvents;
};

export type SigmaObserveOptions = {
  patches?: boolean;
};

export type SigmaObserveChange<TState extends AnyState, TWithPatches extends boolean = false> = {
  readonly previousState: Immutable<TState>;
  readonly state: Immutable<TState>;
} & (TWithPatches extends true
  ? {
      readonly inversePatches: readonly Patch[];
      readonly patches: readonly Patch[];
    }
  : {});

export function isSigmaState(value: unknown): value is AnySigmaState {
  return Boolean(value && typeof value === "object" && (value as AnySigmaState)[sigmaStateBrand]);
}

type SigmaDefinition = {
  state: AnyState;
  events?: AnyEvents;
  computeds?: object;
  queries?: object;
  actions?: object;
  setupArgs?: any[];
};

type UnionToIntersection<U> = (U extends any ? (k: U) => void : never) extends (k: infer I) => void
  ? I
  : never;

// Use this overly complex type so that `SigmaState` isn't erased.
type MapSigmaDefinition<T extends SigmaDefinition> = keyof T extends infer K
  ? K extends "state"
    ? Immutable<T[K]>
    : K extends "computeds"
      ? ComputedValues<T[K]>
      : K extends "queries"
        ? QueryMethods<T[K]>
        : K extends "actions"
          ? ActionMethods<T[K]>
          : K extends "events"
            ? EventMethods<T[K]>
            : K extends "setupArgs"
              ? SetupMethods<T[K]>
              : never
  : never;

export type SigmaState<T extends SigmaDefinition = SigmaDefinition> = AnySigmaState &
  UnionToIntersection<
    | MapSigmaDefinition<T>
    | {
        get<K extends keyof T["state"]>(key: K): ReadonlySignal<Immutable<T["state"][K]>>;
        get<K extends keyof T["computeds"]>(
          key: K,
        ): ReadonlySignal<ComputedValues<T["computeds"]>[K]>;
      }
  >;

type SigmaTypeInternals = {
  actions: Record<string, AnyFunction>;
  computeds: Record<string, AnyFunction>;
  defaultState: Record<string, unknown>;
  defaultStateKeys: string[];
  observeFunctions: Array<{
    listener: AnyFunction;
    patches: boolean;
  }>;
  queries: Record<string, AnyFunction>;
  setupFunctions: AnyFunction[];
};

type ContextKind =
  | "action"
  | "computedDraftAware"
  | "computedReadonly"
  | "observe"
  | "query"
  | "setup";

type SigmaInstance = {
  currentDraft?: Draft<AnyState>;
  currentSetupCleanup?: Cleanup;
  publicInstance: Sigma;
  stateKeys: Set<string>;
  type: SigmaTypeInternals;
  disposed: boolean;
};

const reservedKeys = new Set(["get", "emit", "on", "setup"]);
const dirtyContexts: Record<ContextKind, Set<object>> = {
  action: new Set(),
  computedDraftAware: new Set(),
  computedReadonly: new Set(),
  observe: new Set(),
  query: new Set(),
  setup: new Set(),
};
const contextKinds = Object.keys(dirtyContexts) as ContextKind[];
const internalStates = new WeakMap<object, SigmaInstance>();
const builderStates = new WeakMap<object, SigmaTypeInternals>();
const sigmaRefs = new WeakSet<object>();
const contextCache: Record<ContextKind, WeakMap<object, object>> = {
  action: new WeakMap(),
  computedDraftAware: new WeakMap(),
  computedReadonly: new WeakMap(),
  observe: new WeakMap(),
  query: new WeakMap(),
  setup: new WeakMap(),
};
let contextCacheFlushScheduled = false;

function getInternalState(context: object): SigmaInstance {
  const instance = internalStates.get(context);
  if (!instance) {
    throw new Error("[preact-sigma] Invalid sigma context");
  }
  return instance;
}

function getBuilderState(builder: object): SigmaTypeInternals {
  const state = builderStates.get(builder);
  if (!state) {
    throw new Error("[preact-sigma] Invalid sigma type builder");
  }
  return state;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

export function ref<T extends object>(value: T): SigmaRef<T> {
  if (!isDraftable(value)) {
    throw new Error("[preact-sigma] ref() accepts only an object that can be drafted by Immer");
  }
  sigmaRefs.add(value);
  return value as SigmaRef<T>;
}

function disposeCleanupResource(resource: AnyResource) {
  if (typeof resource === "function") {
    resource();
  } else if (resource instanceof AbortController) {
    resource.abort();
  } else {
    resource[Symbol.dispose]();
  }
}

function createCleanup(resources: readonly AnyResource[]): Cleanup {
  if (!resources.length) {
    return () => {};
  }
  return () => {
    let errors: unknown[] | undefined;
    for (let index = resources.length - 1; index >= 0; index -= 1) {
      try {
        disposeCleanupResource(resources[index]);
      } catch (error) {
        errors ||= [];
        errors.push(error);
      }
    }
    if (errors) {
      throw new AggregateError(errors, "Failed to dispose one or more sigma resources");
    }
  };
}

function snapshotState(instance: SigmaInstance) {
  const snapshot = Object.create(null) as AnyState;
  for (const key of instance.stateKeys) {
    snapshot[key] = getSignal(instance, key).peek();
  }
  return snapshot;
}

type ContextOptions = {
  allowActions: boolean;
  allowQueries: boolean;
  draftAware: boolean;
  liveComputeds: boolean;
};

const ContextOptions = {
  action: {
    allowActions: true,
    allowQueries: true,
    draftAware: true,
    liveComputeds: true,
  },
  computedDraftAware: {
    allowActions: false,
    allowQueries: false,
    draftAware: true,
    liveComputeds: true,
  },
  computedReadonly: {
    allowActions: false,
    allowQueries: false,
    draftAware: false,
    liveComputeds: false,
  },
  query: {
    allowActions: false,
    allowQueries: true,
    draftAware: true,
    liveComputeds: true,
  },
  observe: {
    allowActions: false,
    allowQueries: true,
    draftAware: false,
    liveComputeds: false,
  },
  setup: {
    allowActions: true,
    allowQueries: true,
    draftAware: false,
    liveComputeds: false,
  },
} satisfies Record<ContextKind, ContextOptions>;

function getContext(instance: SigmaInstance, kind: ContextKind) {
  const cachedContext = contextCache[kind].get(instance);
  if (cachedContext) {
    return cachedContext;
  }

  const context = createContext(instance, ContextOptions[kind]);
  internalStates.set(context, instance);

  contextCache[kind].set(instance, context);
  dirtyContexts[kind].add(instance);

  if (!contextCacheFlushScheduled) {
    contextCacheFlushScheduled = true;
    setTimeout(() => {
      for (const kind of contextKinds) {
        for (const queuedInstance of dirtyContexts[kind]) {
          contextCache[kind].delete(queuedInstance);
        }
        dirtyContexts[kind].clear();
      }
      contextCacheFlushScheduled = false;
    }, 0);
  }

  return context;
}

function createContext(instance: SigmaInstance, options: ContextOptions) {
  return new Proxy(contextPrototype, {
    get(_target, key) {
      if (Reflect.has(contextPrototype, key)) {
        return Reflect.get(contextPrototype, key);
      }
      if (typeof key !== "string") {
        return undefined;
      }
      if (key === "emit") {
        return options.allowActions
          ? (name: string, payload?: unknown) =>
              instance.publicInstance.dispatchEvent(new CustomEvent(name, { detail: payload }))
          : undefined;
      }
      if (instance.stateKeys.has(key)) {
        return options.draftAware && instance.currentDraft
          ? instance.currentDraft[key]
          : getSignal(instance, key).value;
      }
      if (key in instance.type.computeds) {
        return options.liveComputeds
          ? instance.type.computeds[key].call(getContext(instance, "computedDraftAware"))
          : getSignal(instance, key).value;
      }
      if (options.allowQueries && key in instance.type.queries) {
        return Reflect.get(instance.publicInstance, key);
      }
      if (options.allowActions && key in instance.type.actions) {
        return Reflect.get(instance.publicInstance, key);
      }
      return undefined;
    },
    set(_target, key, value) {
      if (!options.draftAware || typeof key !== "string" || !instance.currentDraft) {
        return false;
      }
      if (!instance.stateKeys.has(key)) {
        return false;
      }
      instance.currentDraft[key] = value;
      return true;
    },
    has(_target, _key) {
      throw new Error(
        "[preact-sigma] Property existence checks are not supported by context proxies",
      );
    },
  });
}

function runAction(
  instance: SigmaInstance,
  actionFn: AnyFunction,
  actionContext: object,
  args: any[],
) {
  if (instance.disposed) {
    throw new Error("[preact-sigma] Cannot run an action on a disposed sigma state");
  }
  if (instance.currentDraft) {
    return actionFn.apply(actionContext, args);
  }

  const baseState = snapshotState(instance);
  const draft = createDraft(baseState);
  instance.currentDraft = draft;

  let ok = false;
  try {
    const result = actionFn.apply(actionContext, args);
    ok = true;
    return result;
  } finally {
    const currentDraft = instance.currentDraft;
    instance.currentDraft = undefined;

    if (ok) {
      let patches: Patch[] | undefined;
      let inversePatches: Patch[] | undefined;

      const nextState = instance.type.observeFunctions.some((observer) => observer.patches)
        ? finishDraft(currentDraft, (nextPatches, nextInversePatches) => {
            patches = nextPatches;
            inversePatches = nextInversePatches;
          })
        : finishDraft(currentDraft);

      if (nextState !== baseState) {
        for (const key of instance.stateKeys) {
          const value = nextState[key];
          if (isDraftable(value) && !sigmaRefs.has(value as object)) {
            freeze(value);
          }
          updateSignal(instance, key, value);
        }

        if (instance.type.observeFunctions.length) {
          const change: SigmaObserveChange<AnyState, true> = {
            previousState: baseState,
            state: nextState,
            inversePatches: inversePatches!,
            patches: patches!,
          };
          for (const observer of instance.type.observeFunctions) {
            observer.listener.call(getContext(instance, "observe"), change);
          }
        }
      }
    }
  }
}

function assertDefinitionKeyAvailable(
  builder: SigmaTypeInternals,
  key: string,
  kind: "computed" | "query" | "action",
) {
  if (reservedKeys.has(key)) {
    throw new Error(`[preact-sigma] Reserved property name: ${key}`);
  }
  if (key in builder.computeds || key in builder.queries || key in builder.actions) {
    throw new Error(`[preact-sigma] Duplicate key for ${kind}: ${key}`);
  }
}

/** @internal */
export function shouldSetup(
  publicInstance: object,
): publicInstance is { setup(...args: any[]): Cleanup } {
  return getInternalState(publicInstance).type.setupFunctions.length > 0;
}

export type InferSetupArgs<T extends AnySigmaState> = T extends {
  setup(...args: infer TArgs extends any[]): Cleanup;
}
  ? TArgs
  : never;

class Sigma extends EventTarget {
  setup(...args: any[]) {
    const instance = getInternalState(this);
    if (!instance.type.setupFunctions.length) {
      throw new Error("[preact-sigma] Setup is undefined for this sigma state");
    }
    if (instance.disposed) {
      throw new Error("[preact-sigma] Cannot set up a disposed sigma state");
    }
    instance.currentSetupCleanup?.();
    instance.currentSetupCleanup = undefined;

    const cleanup = createCleanup(
      instance.type.setupFunctions.flatMap((setup) => {
        const result = setup.apply(getContext(instance, "setup"), args);
        if (!Array.isArray(result)) {
          throw new Error("[preact-sigma] Sigma setup handlers must return an array");
        }
        return result;
      }),
    );
    instance.currentSetupCleanup = cleanup;
    return cleanup;
  }

  get(key: string) {
    const instance = getInternalState(this);
    return getSignal(instance, key);
  }

  on(name: string, listener: (...args: any[]) => void) {
    const adapter: EventListener = (event) => {
      const payload = (event as CustomEvent).detail;
      if (payload === undefined) {
        listener();
      } else {
        listener(payload);
      }
    };
    this.addEventListener(name, adapter);
    return () => {
      this.removeEventListener(name, adapter);
    };
  }
}
Object.defineProperty(Sigma.prototype, sigmaStateBrand, {
  value: true,
});

const contextPrototype = Object.create(Sigma.prototype);

export function query<TArgs extends any[], TResult>(fn: (this: void, ...args: TArgs) => TResult) {
  return ((...args: TArgs) => computed(() => fn(...args)).value) as typeof fn;
}

function getSignal(instance: SigmaInstance, key: string) {
  return (instance.publicInstance as any)[signalPrefix + key] as ReadonlySignal<any>;
}

function updateSignal(instance: SigmaInstance, key: string, value: unknown) {
  const signal = getSignal(instance, key) as Signal<any>;
  signal.value = value;
}

function initializeSigmaInstance(
  publicInstance: Sigma,
  type: SigmaTypeInternals,
  initialState: AnyState | undefined,
) {
  if (initialState && !isPlainObject(initialState)) {
    throw new Error("[preact-sigma] Sigma state instances require a plain object initial state");
  }

  const stateKeys = new Set(type.defaultStateKeys);
  if (initialState) {
    for (const key in initialState) {
      stateKeys.add(key);
    }
  }

  const instance: SigmaInstance = {
    currentDraft: undefined,
    currentSetupCleanup: undefined,
    publicInstance,
    stateKeys,
    type,
    disposed: false,
  };

  for (const key of stateKeys) {
    if (reservedKeys.has(key)) {
      throw new Error(`[preact-sigma] Reserved property name: ${key}`);
    }
    let value = initialState?.[key];
    if (value === undefined) {
      value =
        typeof type.defaultState[key] === "function"
          ? type.defaultState[key].call(undefined)
          : type.defaultState[key];
    }
    const container = signal(value);
    Object.defineProperty(publicInstance, signalPrefix + key, {
      value: container,
    });
    Object.defineProperty(publicInstance, key, {
      get: () => container.value,
      enumerable: true,
    });
  }
  for (const key in type.computeds) {
    Object.defineProperty(publicInstance, signalPrefix + key, {
      value: computed(() => type.computeds[key].call(getContext(instance, "computedReadonly"))),
    });
  }

  internalStates.set(publicInstance, instance);
}

// oxlint-disable-next-line typescript/no-unsafe-declaration-merging
export class SigmaType<
  TState extends AnyState,
  TEvents extends AnyEvents = {},
  TDefaults extends AnyDefaultState<TState> = {},
  TComputeds extends object = {},
  TQueries extends object = {},
  TActions extends object = {},
  TSetupArgs extends any[] = never,
> extends Function {
  constructor(name: string = "Sigma") {
    super();

    const type: SigmaTypeInternals = {
      actions: Object.create(null),
      computeds: Object.create(null),
      defaultState: Object.create(null),
      defaultStateKeys: [],
      observeFunctions: [],
      queries: Object.create(null),
      setupFunctions: [],
    };

    const { [name]: SigmaTypeBuilder } = {
      [name]: class extends Sigma {
        constructor(initialState?: AnyState) {
          super();
          initializeSigmaInstance(this, type, initialState);
        }
      },
    };

    const { constructor: _constructor, ...builderDescriptors } = Object.getOwnPropertyDescriptors(
      SigmaType.prototype,
    );
    Object.defineProperties(SigmaTypeBuilder, builderDescriptors);
    builderStates.set(SigmaTypeBuilder, type);

    return SigmaTypeBuilder as unknown as SigmaType<
      TState,
      TEvents,
      TDefaults,
      TComputeds,
      TQueries,
      TActions,
      TSetupArgs
    >;
  }

  defaultState<TNextDefaults extends AnyDefaultState<TState>>(defaultState: TNextDefaults) {
    if (!isPlainObject(defaultState)) {
      throw new Error("[preact-sigma] Sigma definitions require a plain object default state");
    }
    const builderState = getBuilderState(this);
    for (const key in defaultState) {
      if (defaultState[key] === undefined) {
        continue;
      }
      builderState.defaultState[key] = defaultState[key];
      builderState.defaultStateKeys.push(key);
    }
    return this as unknown as SigmaType<
      TState,
      TEvents,
      MergeObjects<TDefaults, TNextDefaults>,
      TComputeds,
      TQueries,
      TActions,
      TSetupArgs
    >;
  }

  computed<TNextComputeds extends object>(
    computeds: TNextComputeds &
      ThisType<ComputedContext<TState, MergeObjects<TComputeds, TNextComputeds>>>,
  ) {
    const builderState = getBuilderState(this);
    const nextKeys = Object.keys(computeds) as Array<Extract<keyof TNextComputeds, string>>;
    for (const key of nextKeys) {
      assertDefinitionKeyAvailable(builderState, key, "computed");
      builderState.computeds[key] = computeds[key] as AnyFunction;

      Object.defineProperty(this.prototype, key, {
        get: function (this: any) {
          return this[signalPrefix + key].value;
        },
        enumerable: true,
      });
    }
    return this as unknown as SigmaType<
      TState,
      TEvents,
      TDefaults,
      MergeObjects<TComputeds, TNextComputeds>,
      TQueries,
      TActions,
      TSetupArgs
    >;
  }

  queries<TNextQueries extends object>(
    queries: TNextQueries &
      ThisType<ReadonlyContext<TState, TComputeds, MergeObjects<TQueries, TNextQueries>>>,
  ) {
    const builderState = getBuilderState(this);
    const nextKeys = Object.keys(queries) as Array<Extract<keyof TNextQueries, string>>;
    for (const key of nextKeys) {
      assertDefinitionKeyAvailable(builderState, key, "query");
      const query = queries[key] as AnyFunction;
      builderState.queries[key] = query;

      Object.defineProperty(this.prototype, key, {
        value: function (this: object, ...args: any[]) {
          const instance = getInternalState(this);
          if (instance.currentDraft) {
            return query.apply(getContext(instance, "query"), args);
          }
          return computed(() => query.apply(getContext(instance, "query"), args)).value;
        },
      });
    }
    return this as unknown as SigmaType<
      TState,
      TEvents,
      TDefaults,
      TComputeds,
      MergeObjects<TQueries, TNextQueries>,
      TActions,
      TSetupArgs
    >;
  }

  observe(
    listener: (
      this: ReadonlyContext<TState, TComputeds, TQueries>,
      change: SigmaObserveChange<TState>,
    ) => void,
    options?: SigmaObserveOptions & { patches?: false | undefined },
  ): SigmaType<TState, TEvents, TDefaults, TComputeds, TQueries, TActions, TSetupArgs>;
  observe(
    listener: (
      this: ReadonlyContext<TState, TComputeds, TQueries>,
      change: SigmaObserveChange<TState, true>,
    ) => void,
    options: SigmaObserveOptions & { patches: true },
  ): SigmaType<TState, TEvents, TDefaults, TComputeds, TQueries, TActions, TSetupArgs>;
  observe(listener: AnyFunction, options?: SigmaObserveOptions) {
    const builderState = getBuilderState(this);
    builderState.observeFunctions.push({
      patches: Boolean(options?.patches),
      listener,
    });
    return this as unknown as SigmaType<
      TState,
      TEvents,
      TDefaults,
      TComputeds,
      TQueries,
      TActions,
      TSetupArgs
    >;
  }

  actions<TNextActions extends object>(
    actions: TNextActions &
      ThisType<
        ActionContext<TState, TEvents, TComputeds, TQueries, MergeObjects<TActions, TNextActions>>
      >,
  ) {
    const builderState = getBuilderState(this);
    const nextKeys = Object.keys(actions) as Array<Extract<keyof TNextActions, string>>;
    for (const key of nextKeys) {
      assertDefinitionKeyAvailable(builderState, key, "action");
      const action = actions[key] as AnyFunction;
      builderState.actions[key] = action;

      Object.defineProperty(this.prototype, key, {
        value: function (this: object, ...args: any[]) {
          const instance = getInternalState(this);
          return runAction(instance, action, getContext(instance, "action"), args);
        },
      });
    }
    return this as unknown as SigmaType<
      TState,
      TEvents,
      TDefaults,
      TComputeds,
      TQueries,
      MergeObjects<TActions, TNextActions>,
      TSetupArgs
    >;
  }

  setup<TNextSetupArgs extends [TSetupArgs] extends [never] ? any[] : NonNullable<TSetupArgs>>(
    setup: (
      this: SetupContext<{
        state: TState;
        events: TEvents;
        computeds: TComputeds;
        queries: TQueries;
        actions: TActions;
        setupArgs: TNextSetupArgs;
      }>,
      ...args: TNextSetupArgs
    ) => readonly AnyResource[],
  ) {
    const builderState = getBuilderState(this);
    builderState.setupFunctions.push(setup);

    return this as unknown as SigmaType<
      TState,
      TEvents,
      TDefaults,
      TComputeds,
      TQueries,
      TActions,
      TNextSetupArgs
    >;
  }
}

// Specialized Omit type to encourage type erasure.
type Omit<T, K> = {} & { [P in Exclude<keyof T, K>]: T[P] };
type OmitEmpty<T extends object> = {} & Omit<
  T,
  { [K in keyof T]: [undefined] extends [T[K]] ? K : [{}] extends [T[K]] ? K : never }[keyof T]
>;

export interface SigmaType<
  TState extends AnyState,
  TEvents extends AnyEvents = {},
  TDefaults extends AnyDefaultState<TState> = {},
  TComputeds extends object = {},
  TQueries extends object = {},
  TActions extends object = {},
  TSetupArgs extends any[] = never,
> {
  new (...args: InitialStateInput<TState, TDefaults>): SigmaState<
    Extract<
      OmitEmpty<{
        state: TState;
        events: TEvents;
        computeds: TComputeds;
        queries: TQueries;
        actions: TActions;
        setupArgs: TSetupArgs;
      }>,
      SigmaDefinition
    >
  >;
}
