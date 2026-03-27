import { computed, type ReadonlySignal, Signal, signal } from "@preact/signals";
import { createDraft, finishDraft, freeze, isDraftable, type Patch } from "immer";
import type { Draft } from "../immer";
import { getContext } from "./context.js";
import { reservedKeys, signalPrefix, sigmaRefs } from "./symbols.js";
import type { AnyFunction, AnyResource, AnyState, Cleanup, SigmaObserveChange } from "./types.js";

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

export type SigmaInstance = {
  currentDraft?: Draft<AnyState>;
  currentSetupCleanup?: Cleanup;
  publicInstance: EventTarget & object;
  stateKeys: Set<string>;
  type: SigmaTypeInternals;
  disposed: boolean;
};

const internalStates = new WeakMap<object, SigmaInstance>();
const builderStates = new WeakMap<object, SigmaTypeInternals>();

export function registerInternalState(context: object, instance: SigmaInstance) {
  internalStates.set(context, instance);
}

export function getInternalState(context: object): SigmaInstance {
  const instance = internalStates.get(context);
  if (!instance) {
    throw new Error("[preact-sigma] Invalid sigma context");
  }
  return instance;
}

export function registerBuilderState(builder: object, type: SigmaTypeInternals) {
  builderStates.set(builder, type);
}

export function getBuilderState(builder: object): SigmaTypeInternals {
  const state = builderStates.get(builder);
  if (!state) {
    throw new Error("[preact-sigma] Invalid sigma type builder");
  }
  return state;
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

export function getSignal(instance: SigmaInstance, key: string) {
  return (instance.publicInstance as any)[signalPrefix + key] as ReadonlySignal<any>;
}

export function initializeSigmaInstance(
  publicInstance: EventTarget & object,
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

  registerInternalState(publicInstance, instance);
}

export function runAction(
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

export function shouldSetup(
  publicInstance: object,
): publicInstance is { setup(...args: any[]): Cleanup } {
  return getInternalState(publicInstance).type.setupFunctions.length > 0;
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

function updateSignal(instance: SigmaInstance, key: string, value: unknown) {
  const nextSignal = getSignal(instance, key) as Signal<any>;
  nextSignal.value = value;
}

function snapshotState(instance: SigmaInstance) {
  const snapshot = Object.create(null) as AnyState;
  for (const key of instance.stateKeys) {
    snapshot[key] = getSignal(instance, key).peek();
  }
  return snapshot;
}
