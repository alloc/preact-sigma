import { action, computed, type ReadonlySignal, Signal, signal } from "@preact/signals";
import { createDraft, finishDraft, freeze, isDraftable, type Patch } from "immer";
import type { Draft } from "../immer";
import { getContext, setContextPrototype } from "./context.js";
import { reservedKeys, sigmaRefs, sigmaStateBrand, signalPrefix } from "./symbols.js";
import type {
  AnyFunction,
  AnyResource,
  AnySigmaState,
  AnySigmaType,
  AnyState,
  Cleanup,
  SigmaObserveChange,
} from "./types.js";

export type SigmaTypeInternals = {
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

export type SigmaInternals = {
  currentDraft?: Draft<AnyState>;
  currentSetupCleanup?: Cleanup;
  publicInstance: EventTarget & object;
  stateKeys: Set<string>;
  type: SigmaTypeInternals;
  disposed: boolean;
};

const sigmaInternalsMap = new WeakMap<object, SigmaInternals>();
const typeInternalsMap = new WeakMap<object, SigmaTypeInternals>();

export function registerSigmaInternals(context: AnySigmaState, instance: SigmaInternals) {
  sigmaInternalsMap.set(context, instance);
}

export function getSigmaInternals(context: AnySigmaState): SigmaInternals {
  const instance = sigmaInternalsMap.get(context);
  if (!instance) {
    throw new Error("[preact-sigma] Invalid sigma context");
  }
  return instance;
}

export function registerTypeInternals(builder: AnySigmaType, type: SigmaTypeInternals) {
  typeInternalsMap.set(builder, type);
}

export function getTypeInternals(type: AnySigmaType): SigmaTypeInternals {
  const internalType = typeInternalsMap.get(type);
  if (!internalType) {
    throw new Error("[preact-sigma] Invalid sigma type builder");
  }
  return internalType;
}

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

export function createCleanup(resources: readonly AnyResource[]): Cleanup {
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

export function getSignal(instance: SigmaInternals, key: string) {
  return (instance.publicInstance as any)[signalPrefix + key] as ReadonlySignal<any>;
}

export function initializeSigmaInstance(
  publicInstance: AnySigmaState,
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

  const instance: SigmaInternals = {
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

  registerSigmaInternals(publicInstance, instance);
}

export function buildActionMethod(actionFn: AnyFunction) {
  return action(function (this: AnySigmaState, ...args: any[]) {
    const instance = getSigmaInternals(this);
    if (instance.disposed) {
      throw new Error("[preact-sigma] Cannot run an action on a disposed sigma state");
    }
    const actionContext = getContext(instance, "action");
    if (instance.currentDraft) {
      const result = actionFn.apply(actionContext, args);
      assertSynchronousActionResult(result);
      return result;
    }

    const baseState = snapshotState(instance);
    const draft = createDraft(baseState);
    instance.currentDraft = draft;

    let ok = false;
    try {
      const result = actionFn.apply(actionContext, args);
      assertSynchronousActionResult(result);
      ok = true;
      return result;
    } finally {
      const currentDraft = instance.currentDraft!;
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
  });
}

function assertSynchronousActionResult(result: unknown) {
  if (
    result &&
    (typeof result === "object" || typeof result === "function") &&
    typeof (result as PromiseLike<unknown>).then === "function"
  ) {
    void Promise.resolve(result).catch(() => {});
    throw new Error(
      "[preact-sigma] Actions must finish synchronously. Do async work outside the action and call actions before and after await.",
    );
  }
}

export function assertDefinitionKeyAvailable(
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

export function shouldSetup(publicInstance: AnySigmaState): publicInstance is AnySigmaState & {
  setup(...args: any[]): Cleanup;
} {
  const instance = getSigmaInternals(publicInstance);
  return instance.type.setupFunctions.length > 0;
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

function updateSignal(instance: SigmaInternals, key: string, value: unknown) {
  const nextSignal = getSignal(instance, key) as Signal<any>;
  nextSignal.value = value;
}

function snapshotState(instance: SigmaInternals) {
  const snapshot = Object.create(null) as AnyState;
  for (const key of instance.stateKeys) {
    snapshot[key] = getSignal(instance, key).peek();
  }
  return snapshot;
}

// oxlint-disable-next-line typescript/no-unsafe-declaration-merging
export class Sigma extends EventTarget {
  setup(...args: any[]): Cleanup {
    const instance = getSigmaInternals(this);
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
    const instance = getSigmaInternals(this);
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
export interface Sigma {
  readonly [sigmaStateBrand]: true;
}
Object.defineProperty(Sigma.prototype, sigmaStateBrand, {
  value: true,
});
setContextPrototype(Sigma.prototype);
