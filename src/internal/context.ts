import { getSignal, registerSigmaInternals, type SigmaInternals } from "./runtime.js";
import { AnySigmaState } from "./types.js";

type ContextKind =
  | "action"
  | "computedDraftAware"
  | "computedReadonly"
  | "observe"
  | "query"
  | "setup";

type ContextOptions = {
  allowActions: boolean;
  allowQueries: boolean;
  draftAware: boolean;
  liveComputeds: boolean;
};

const contextOptions = {
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

const dirtyContexts: Record<ContextKind, Set<object>> = {
  action: new Set(),
  computedDraftAware: new Set(),
  computedReadonly: new Set(),
  observe: new Set(),
  query: new Set(),
  setup: new Set(),
};
const contextKinds = Object.keys(dirtyContexts) as ContextKind[];
const contextCache: Record<ContextKind, WeakMap<object, object>> = {
  action: new WeakMap(),
  computedDraftAware: new WeakMap(),
  computedReadonly: new WeakMap(),
  observe: new WeakMap(),
  query: new WeakMap(),
  setup: new WeakMap(),
};
let contextCacheFlushScheduled = false;
let contextPrototype = Object.prototype;

export function setContextPrototype(prototype: object) {
  contextPrototype = prototype;
}

export function getContext(instance: SigmaInternals, kind: ContextKind) {
  const cachedContext = contextCache[kind].get(instance);
  if (cachedContext) {
    return cachedContext;
  }

  const context = createContext(instance, contextOptions[kind]);
  registerSigmaInternals(context, instance);

  contextCache[kind].set(instance, context);
  dirtyContexts[kind].add(instance);

  if (!contextCacheFlushScheduled) {
    contextCacheFlushScheduled = true;
    setTimeout(() => {
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

function createContext(instance: SigmaInternals, options: ContextOptions) {
  return new Proxy(contextPrototype as AnySigmaState, {
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
