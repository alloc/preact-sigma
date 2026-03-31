import {
  commitActionOwner,
  getSignal,
  handleActionBoundary,
  readActionComputedValue,
  readActionStateValue,
  registerSigmaInternals,
  runAdHocAction,
  setActionStateValue,
  type ActionOwner,
  type SigmaInternals,
} from "./runtime.js";
import type { AnySigmaState } from "./types.js";

type PublicContextKind = "computedReadonly" | "observe" | "queryCommitted" | "setup";
type OwnerContextKind = "action" | "computedDraftAware" | "queryDraftAware";
type ContextKind = OwnerContextKind | PublicContextKind;

export type ContextOptions = {
  /** Exposes `this.act(...)` on setup contexts. */
  allowAct: boolean;
  /** Exposes public action methods on `this`. */
  allowActions: boolean;
  /** Exposes `this.commit()` on action contexts. */
  allowCommit: boolean;
  /** Exposes `this.emit(...)` on the context. */
  allowEmit: boolean;
  /** Exposes public query methods on `this`. */
  allowQueries: boolean;
  /** Allows direct top-level state assignment through the proxy. */
  allowWrites: boolean;
  /** Reads state and computeds through the owner draft instead of committed signals. */
  draftAware: boolean;
  /** Creates a draft from a read when the read must support later mutation semantics. */
  draftOnRead: boolean;
  /** Evaluates computeds live against the current draft-aware context. */
  liveComputeds: boolean;
  /** Reads signals through `.value` so the caller participates in tracking. */
  reactiveReads: boolean;
};

const disabledContextOptions = {
  allowAct: false,
  allowActions: false,
  allowCommit: false,
  allowEmit: false,
  allowQueries: false,
  allowWrites: false,
  draftAware: false,
  draftOnRead: false,
  liveComputeds: false,
  reactiveReads: false,
} satisfies ContextOptions;

const publicContextOptions = {
  computedReadonly: {
    ...disabledContextOptions,
    reactiveReads: true,
  },
  observe: {
    ...disabledContextOptions,
    allowQueries: true,
  },
  queryCommitted: {
    ...disabledContextOptions,
    allowQueries: true,
    reactiveReads: true,
  },
  setup: {
    ...disabledContextOptions,
    allowAct: true,
    allowActions: true,
    allowEmit: true,
    allowQueries: true,
  },
} satisfies Record<PublicContextKind, ContextOptions>;

const ownerContextOptions = {
  action: {
    ...disabledContextOptions,
    allowActions: true,
    allowCommit: true,
    allowEmit: true,
    allowQueries: true,
    allowWrites: true,
    draftAware: true,
    draftOnRead: true,
    liveComputeds: true,
  },
  computedDraftAware: {
    ...disabledContextOptions,
    draftAware: true,
    liveComputeds: true,
  },
  queryDraftAware: {
    ...disabledContextOptions,
    allowQueries: true,
    draftAware: true,
    liveComputeds: true,
  },
} satisfies Record<OwnerContextKind, ContextOptions>;

const dirtyContexts: Record<PublicContextKind, Set<object>> = {
  computedReadonly: new Set(),
  observe: new Set(),
  queryCommitted: new Set(),
  setup: new Set(),
};
const contextKinds = Object.keys(dirtyContexts) as PublicContextKind[];
const contextCache: Record<PublicContextKind, WeakMap<object, object>> = {
  computedReadonly: new WeakMap(),
  observe: new WeakMap(),
  queryCommitted: new WeakMap(),
  setup: new WeakMap(),
};
// Action/query/computed draft-aware contexts are invocation-scoped, so only the
// reusable public contexts live in the global cache.
const contextOwnerMap = new WeakMap<object, ActionOwner>();
let contextCacheFlushScheduled = false;

export function getContext(target: SigmaInternals, kind: PublicContextKind): object;
export function getContext(target: ActionOwner, kind: OwnerContextKind): object;
export function getContext(target: SigmaInternals | ActionOwner, kind: ContextKind) {
  if (isOwnerContextKind(kind)) {
    return getOwnerContext(target as ActionOwner, kind);
  }
  return getPublicContext(target as SigmaInternals, kind);
}

export function getContextOwner(context: object) {
  return contextOwnerMap.get(context);
}

export function registerContextOwner(context: object, owner: ActionOwner) {
  contextOwnerMap.set(context, owner);
}

function createContext(
  instance: SigmaInternals,
  options: ContextOptions,
  owner: ActionOwner | undefined,
) {
  const publicPrototype = Object.getPrototypeOf(instance.publicInstance) as AnySigmaState;
  return new Proxy(publicPrototype, {
    get(_target, key, receiver) {
      if (typeof key !== "string") {
        return Reflect.get(publicPrototype, key, owner?.actionContext ?? instance.publicInstance);
      }
      if (key === "act") {
        return options.allowAct
          ? (actionFn: unknown) => {
              if (typeof actionFn !== "function") {
                throw new Error("[preact-sigma] act() requires a function");
              }
              return runAdHocAction(receiver, actionFn as (...args: any[]) => unknown);
            }
          : undefined;
      }
      if (key === "commit") {
        return options.allowCommit && owner ? () => commitActionOwner(owner) : undefined;
      }
      if (key === "emit") {
        return options.allowEmit && owner
          ? (name: string, detail?: unknown) => {
              // `emit()` is always a boundary: same-owner unpublished changes throw,
              // and foreign drafts are resolved here before dispatching.
              handleActionBoundary(owner, "emit");

              instance.publicInstance.dispatchEvent(new CustomEvent(name, { detail }));
            }
          : undefined;
      }
      if (instance.stateKeys.has(key)) {
        if (owner && options.draftAware) {
          return readActionStateValue(owner, key, options);
        }
        const signal = getSignal(instance, key);
        return options.reactiveReads ? signal.value : signal.peek();
      }
      if (key in instance.type.computeFunctions) {
        if (owner && options.liveComputeds) {
          return readActionComputedValue(owner, key);
        }
        const signal = getSignal(instance, key);
        return options.reactiveReads ? signal.value : signal.peek();
      }
      if (options.allowQueries && key in instance.type.queryFunctions) {
        return Reflect.get(instance.publicInstance, key);
      }
      if (options.allowActions && key in instance.type.actionFunctions) {
        return Reflect.get(instance.publicInstance, key);
      }
      if (Reflect.has(publicPrototype, key)) {
        return Reflect.get(publicPrototype, key, owner?.actionContext ?? instance.publicInstance);
      }
      return undefined;
    },
    set(_target, key, value) {
      if (
        !owner ||
        !options.allowWrites ||
        typeof key !== "string" ||
        !instance.stateKeys.has(key)
      ) {
        return false;
      }
      setActionStateValue(owner, key, value);
      return true;
    },
    apply: unsupportedOperation,
    construct: unsupportedOperation,
    defineProperty: unsupportedOperation,
    deleteProperty: unsupportedOperation,
    getOwnPropertyDescriptor: unsupportedOperation,
    has: unsupportedOperation,
    isExtensible: unsupportedOperation,
    ownKeys: unsupportedOperation,
    preventExtensions: unsupportedOperation,
    setPrototypeOf: unsupportedOperation,
  });
}

function unsupportedOperation(): never {
  throw new Error("[preact-sigma] This operation is not supported by context proxies");
}

const kindToOwnerContextKey = {
  action: "actionContext",
  computedDraftAware: "computedContext",
  queryDraftAware: "queryContext",
} satisfies Record<OwnerContextKind, keyof ActionOwner>;

function isOwnerContextKind(kind: ContextKind): kind is OwnerContextKind {
  return kind in kindToOwnerContextKey;
}

function getOwnerContext(owner: ActionOwner, kind: OwnerContextKind) {
  const contextKey = kindToOwnerContextKey[kind];
  if (owner[contextKey]) {
    return owner[contextKey];
  }
  const context = createContext(owner.instance, ownerContextOptions[kind], owner);
  registerSigmaInternals(context, owner.instance);
  registerContextOwner(context, owner);
  owner[contextKey] = context;
  return context;
}

function getPublicContext(instance: SigmaInternals, kind: PublicContextKind) {
  const cachedContext = contextCache[kind].get(instance);
  if (cachedContext) {
    return cachedContext;
  }

  const context = createContext(instance, publicContextOptions[kind], undefined);
  registerSigmaInternals(context, instance);

  contextCache[kind].set(instance, context);
  dirtyContexts[kind].add(instance);

  if (!contextCacheFlushScheduled) {
    contextCacheFlushScheduled = true;
    setTimeout(() => {
      // Public contexts are safe to reuse only within the current turn. Flushing on
      // the next macrotask keeps the cache cheap without letting it retain stale
      // builder state forever.
      for (const queuedKind of contextKinds) {
        for (const queuedInstance of dirtyContexts[queuedKind]) {
          contextCache[queuedKind].delete(queuedInstance);
        }
        dirtyContexts[queuedKind].clear();
      }
      contextCacheFlushScheduled = false;
    }, 0);
  }

  return context;
}
