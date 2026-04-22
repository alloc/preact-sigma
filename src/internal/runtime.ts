import { batch, computed, type ReadonlySignal, Signal, signal, untracked } from "@preact/signals";
import type { Patch } from "immer";
import * as immer from "immer";
import type { Draft, Immutable } from "../immer";
import { SigmaListenerMap } from "../listener.js";
import { ContextOptions, getContext, getContextOwner, registerContextOwner } from "./context.js";
import { reservedKeys, sigmaStateBrand, sigmaTargetBrand, signalPrefix } from "./symbols.js";
import type {
  AnyFunction,
  AnyResource,
  AnySigmaState,
  AnyState,
  Cleanup,
  SigmaChangeListener,
  SigmaDefinition,
  SigmaSignals,
  SigmaState,
  SigmaSubscribeOptions,
} from "./types.js";

export type SigmaTypeInternals = {
  _actionFunctions: Record<string, AnyFunction>;
  _computeFunctions: Record<string, AnyFunction>;
  _defaultState: Record<string, unknown>;
  _defaultStateKeys: string[];
  _queryFunctions: Record<string, AnyFunction>;
  _setupFunction: AnyFunction | null;
};

export type ActionOwner = {
  actionContext?: AnySigmaState;
  actionFn: AnyFunction;
  actionName: string;
  args: readonly unknown[];
  computedContext?: object;
  currentBase?: AnyState;
  currentDraft?: Draft<AnyState>;
  id: number;
  instance: SigmaInternals;
  publicInstance: AnySigmaState;
  queryContext?: object;
};

export type SigmaInternals = {
  changeSubscriptions: Set<SigmaChangeSubscription>;
  currentSetupCleanup?: Cleanup;
  patchSubscriptions: number;
  publicInstance: AnySigmaState;
  stateKeys: Set<string>;
  type: SigmaTypeInternals;
  disposed: boolean;
};

type SigmaChangeSubscription = {
  listener: AnyFunction;
  patches: boolean;
};

const sigmaInternalsMap = new WeakMap<object, SigmaInternals>();
let autoFreezeEnabled = true;

let nextActionOwnerId = 1;
// At most one action draft may exist at a time. Same-instance sync nested
// actions reuse that draft; every other boundary resolves it first.
let currentDraftOwner: ActionOwner | undefined;

type FinalizedDraftResult = {
  changed: boolean;
  inversePatches?: Patch[];
  newState: AnyState;
  oldState: AnyState;
  patches?: Patch[];
};

export function registerSigmaInternals(context: object, instance: SigmaInternals) {
  sigmaInternalsMap.set(context, instance);
}

export function getSigmaInternals(context: object): SigmaInternals {
  const instance = sigmaInternalsMap.get(context);
  if (!instance) {
    throw new Error("[preact-sigma] Invalid sigma context");
  }
  return instance;
}

/** Controls whether sigma deep-freezes published public state. Auto-freezing starts enabled and the setting is shared across instances. */
export function setAutoFreeze(autoFreeze: boolean) {
  autoFreezeEnabled = autoFreeze;
  immer.setAutoFreeze(autoFreeze);
}

export function getSignal(instance: SigmaInternals, key: string) {
  return (instance.publicInstance as any)[signalPrefix + key] as ReadonlySignal<any>;
}

export function initializeSigmaInstance(
  publicInstance: AnySigmaState,
  type: SigmaTypeInternals,
  initialState: AnyState | undefined,
) {
  const stateKeys = new Set(type._defaultStateKeys);
  if (initialState) {
    for (const key in initialState) {
      stateKeys.add(key);
    }
  }

  const instance: SigmaInternals = {
    changeSubscriptions: new Set(),
    currentSetupCleanup: undefined,
    patchSubscriptions: 0,
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
        typeof type._defaultState[key] === "function"
          ? type._defaultState[key].call(undefined)
          : type._defaultState[key];
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
  for (const key in type._computeFunctions) {
    Object.defineProperty(publicInstance, signalPrefix + key, {
      value: computed(() =>
        type._computeFunctions[key].call(getContext(instance, "computedReadonly")),
      ),
    });
  }

  registerSigmaInternals(publicInstance, instance);
}

export function buildQueryMethod(queryFunction: AnyFunction) {
  return function (this: AnySigmaState, ...args: any[]) {
    const instance = getSigmaInternals(this);
    const owner = getContextOwner(this);
    if (owner) {
      return queryFunction.apply(getContext(owner, "queryDraftAware"), args);
    }
    return computed(() => queryFunction.apply(getContext(instance, "queryCommitted"), args)).value;
  };
}

export function buildActionMethod(actionName: string, actionFn: AnyFunction) {
  return function (this: AnySigmaState, ...args: any[]) {
    return runActionInvocation(this, actionName, actionFn, args);
  };
}

export function runAdHocAction(context: object, actionFn: AnyFunction) {
  return runActionInvocation(context, "act()", actionFn, []);
}

export function readActionStateValue(owner: ActionOwner, key: string, options: ContextOptions) {
  if (owner.currentDraft) {
    return owner.currentDraft[key];
  }

  const signal = getSignal(owner.instance, key);
  const committedValue = options.reactiveReads ? signal.value : signal.peek();

  if (options.draftOnRead && immer.isDraftable(committedValue)) {
    return ensureOwnerDraft(owner)[key];
  }

  return committedValue;
}

export function readActionComputedValue(owner: ActionOwner, key: string) {
  return owner.instance.type._computeFunctions[key].call(getContext(owner, "computedDraftAware"));
}

export function setActionStateValue(owner: ActionOwner, key: string, value: unknown) {
  ensureOwnerDraft(owner)[key] = value;
}

export function commitActionOwner(owner: ActionOwner) {
  const finalized = finalizeOwnerDraft(owner);
  if (finalized?.changed) {
    publishState(owner.instance, finalized);
  }
}

export function handleActionBoundary(
  owner: ActionOwner | undefined,
  boundary: "action" | "emit",
  actionName?: string,
) {
  const draftOwner = currentDraftOwner;
  if (!draftOwner?.currentDraft) {
    return;
  }

  const finalized = finalizeOwnerDraft(draftOwner);
  if (!finalized?.changed) {
    return;
  }

  if (draftOwner === owner) {
    const message =
      boundary === "emit"
        ? `[preact-sigma] Action "${draftOwner.actionName}" has unpublished changes. Call this.commit() before emit().`
        : `[preact-sigma] Action "${draftOwner.actionName}" has unpublished changes. Call this.commit() before calling another action.`;
    throw new Error(message);
  }

  if (boundary === "emit") {
    throw new Error("[preact-sigma] Unexpected emit boundary. This is a bug.");
  }

  console.warn(
    `[preact-sigma] Discarded unpublished action changes from "${draftOwner.actionName}" before running "${actionName ?? "another action"}".`,
    {
      action: draftOwner.actionFn,
      actionArgs: draftOwner.args,
      actionId: draftOwner.id,
      actionName: draftOwner.actionName,
      draftedInstance: currentDraftOwner?.publicInstance ?? draftOwner.publicInstance,
      instance: draftOwner.instance.publicInstance,
    },
  );
}

export function assertDefinitionKeyAvailable(
  builder: SigmaTypeInternals,
  key: string,
  kind: "computed" | "query" | "action",
) {
  if (reservedKeys.has(key)) {
    throw new Error(`[preact-sigma] Reserved property name: ${key}`);
  }
  if (
    key in builder._computeFunctions ||
    key in builder._queryFunctions ||
    key in builder._actionFunctions
  ) {
    throw new Error(`[preact-sigma] Duplicate key for ${kind}: ${key}`);
  }
}

export function shouldSetup(publicInstance: AnySigmaState): publicInstance is AnySigmaState & {
  setup(...args: any[]): Cleanup;
} {
  const instance = getSigmaInternals(publicInstance);
  return instance.type._setupFunction !== null;
}

function clearCurrentDraft(owner: ActionOwner) {
  owner.currentDraft = undefined;
  owner.currentBase = undefined;
  if (currentDraftOwner === owner) {
    currentDraftOwner = undefined;
  }
}

function createActionOwner(
  instance: SigmaInternals,
  actionName: string,
  actionFn: AnyFunction,
  args: readonly unknown[],
): ActionOwner {
  const owner: ActionOwner = {
    actionFn,
    actionName,
    args,
    id: nextActionOwnerId++,
    instance,
    publicInstance: instance.publicInstance,
  };
  owner.actionContext = getContext(owner, "action") as AnySigmaState;
  registerSigmaInternals(owner.actionContext, instance);
  registerContextOwner(owner.actionContext, owner);
  return owner;
}

function runActionInvocation(
  context: object,
  actionName: string,
  actionFn: AnyFunction,
  args: any[],
) {
  const instance = getSigmaInternals(context);
  if (instance.disposed) {
    throw new Error("[preact-sigma] Cannot run an action on a disposed sigma state");
  }

  const isAdHocAction = actionName === "act()";
  const actionIsAsync = actionFn.constructor.name === "AsyncFunction";
  if (actionIsAsync && isAdHocAction) {
    throw new Error("[preact-sigma] act() callbacks must stay synchronous");
  }

  return untracked(() => {
    let owner: ActionOwner;

    const callerOwner = getContextOwner(context);
    if (callerOwner && callerOwner.instance === instance && !actionIsAsync) {
      owner = callerOwner;
    } else {
      handleActionBoundary(callerOwner, "action", actionName);
      owner = createActionOwner(instance, actionName, actionFn, args);
    }

    let result: unknown;
    try {
      result = actionFn.apply(owner.actionContext, args);
    } catch (error) {
      clearCurrentDraft(owner);
      throw error;
    }

    if (isAdHocAction && isPromiseLike(result)) {
      clearCurrentDraft(owner);
      void Promise.resolve(result).catch(() => {});
      throw new Error("[preact-sigma] act() callbacks must stay synchronous");
    }

    if (!actionIsAsync && isPromiseLike(result)) {
      clearCurrentDraft(owner);
      void Promise.resolve(result).catch(() => {});
      throw new Error(
        `[preact-sigma] Action "${actionName}" must use native async-await syntax to return a promise.`,
      );
    }

    if (owner === callerOwner) {
      return result;
    }

    const finalized = finalizeOwnerDraft(owner);
    if (finalized?.changed) {
      publishState(instance, finalized);
    }
    if (isPromiseLike(result)) {
      return resolveAsyncActionResult(owner, result);
    }
    return result;
  });
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

function assertExactStateKeys(stateKeys: Set<string>, nextState: AnyState) {
  const extraKeys = Object.keys(nextState).filter((key) => !stateKeys.has(key));
  const missingKeys = [...stateKeys].filter(
    (key) => !Object.prototype.hasOwnProperty.call(nextState, key),
  );

  if (!extraKeys.length && !missingKeys.length) {
    return;
  }

  let message = "[preact-sigma] replaceState() requires exactly the instance's state keys";
  if (missingKeys.length) {
    message += `. Missing: ${missingKeys.join(", ")}`;
  }
  if (extraKeys.length) {
    message += `. Extra: ${extraKeys.join(", ")}`;
  }
  throw new Error(message);
}

function assertNoPendingDraft(operationName: string) {
  const owner = currentDraftOwner;
  if (!owner?.currentDraft) {
    return;
  }
  throw new Error(
    `[preact-sigma] ${operationName}() cannot run while action "${owner.actionName}" has unpublished changes. Call this.commit() before ${operationName}().`,
  );
}

function snapshotState(instance: SigmaInternals) {
  const snapshot = Object.create(null) as AnyState;
  for (const key of instance.stateKeys) {
    snapshot[key] = getSignal(instance, key).peek();
  }
  return snapshot;
}

function ensureOwnerDraft(owner: ActionOwner) {
  if (owner.currentDraft) {
    return owner.currentDraft;
  }

  // Another invocation may already own the one global draft slot. Resolve it
  // before this owner starts a new draft so drafts never overlap.
  handleActionBoundary(owner, "action", owner.actionName);

  // Every action phase is draft-lazy. A draft opens only on the first write or
  // on a read that needs draft-backed mutation semantics.
  owner.currentBase = snapshotState(owner.instance);
  owner.currentDraft = immer.createDraft(owner.currentBase);
  currentDraftOwner = owner;

  return owner.currentDraft;
}

function finalizeOwnerDraft(owner: ActionOwner): FinalizedDraftResult | undefined {
  const currentDraft = owner.currentDraft;
  const oldState = owner.currentBase;
  if (!currentDraft || !oldState) {
    return undefined;
  }

  clearCurrentDraft(owner);

  let patches: Patch[] | undefined;
  let inversePatches: Patch[] | undefined;

  const newState =
    owner.instance.patchSubscriptions > 0
      ? immer.finishDraft(currentDraft, (nextPatches, nextInversePatches) => {
          patches = nextPatches;
          inversePatches = nextInversePatches;
        })
      : immer.finishDraft(currentDraft);

  return {
    changed: newState !== oldState,
    inversePatches,
    newState,
    oldState,
    patches,
  };
}

function finalizeReplacementState(
  instance: SigmaInternals,
  oldState: AnyState,
  nextState: AnyState,
): FinalizedDraftResult {
  const draft = immer.createDraft(oldState);
  for (const key of instance.stateKeys) {
    draft[key] = nextState[key];
  }

  let patches: Patch[] | undefined;
  let inversePatches: Patch[] | undefined;

  const newState =
    instance.patchSubscriptions > 0
      ? immer.finishDraft(draft, (nextPatches, nextInversePatches) => {
          patches = nextPatches;
          inversePatches = nextInversePatches;
        })
      : immer.finishDraft(draft);

  return {
    changed: newState !== oldState,
    inversePatches,
    newState,
    oldState,
    patches,
  };
}

function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
  return value != null && typeof (value as PromiseLike<unknown>).then === "function";
}

function publishState(instance: SigmaInternals, finalized: FinalizedDraftResult) {
  batch(() => {
    for (const key of instance.stateKeys) {
      const nextValue = finalized.newState[key];
      if (autoFreezeEnabled) {
        immer.freeze(nextValue, true);
      }
      const signal = getSignal(instance, key) as Signal<any>;
      signal.value = nextValue;
    }
  });

  if (instance.changeSubscriptions.size) {
    const context = getContext(instance, "observe");
    for (const subscription of instance.changeSubscriptions) {
      subscription.listener.call(context, finalized);
    }
  }
}

function isPlainObject(value: unknown): value is object {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/**
 * Utility helpers for sigma-state instances.
 *
 * The helpers expose instance-specific built-ins without reserving names on the
 * public instance object.
 */
export const sigma = Object.freeze({
  /** Returns the underlying signal for a top-level state property or computed. */
  getSignal: <T extends SigmaDefinition, K extends Extract<keyof SigmaSignals<T>, string>>(
    publicInstance: SigmaState<T>,
    key: K,
  ) => {
    return (publicInstance as any)[signalPrefix + key] as ReadonlySignal<SigmaSignals<T>[K]>;
  },

  /** Returns a shallow snapshot of an instance's committed public state. */
  getState: <T extends SigmaDefinition>(publicInstance: SigmaState<T>) => {
    return snapshotState(getSigmaInternals(publicInstance)) as Immutable<T["state"]>;
  },

  /** Replaces an instance's committed public state from a snapshot object. */
  replaceState: <T extends SigmaDefinition>(
    publicInstance: SigmaState<T>,
    nextState: Immutable<T["state"]>,
  ) => {
    const instance = getSigmaInternals(publicInstance);
    if (!isPlainObject(nextState)) {
      throw new Error("[preact-sigma] replaceState() requires a plain object snapshot");
    }

    assertNoPendingDraft("replaceState");
    assertExactStateKeys(instance.stateKeys, nextState);

    const oldState = snapshotState(instance);
    const finalized = finalizeReplacementState(instance, oldState, nextState as AnyState);
    if (finalized.changed) {
      publishState(instance, finalized);
    }
  },

  /** Subscribes to committed state changes or one top-level property signal. */
  subscribe: ((
    publicInstance: AnySigmaState,
    keyOrListener: string | SigmaChangeListener,
    listenerOrOptions?: ((value: unknown) => void) | SigmaSubscribeOptions,
  ): Cleanup => {
    const instance = getSigmaInternals(publicInstance);

    if (typeof keyOrListener === "string") {
      return getSignal(instance, keyOrListener).subscribe(listenerOrOptions as AnyFunction);
    }

    const options = listenerOrOptions as SigmaSubscribeOptions | undefined;
    const subscription = {
      listener: keyOrListener,
      patches: options?.patches ?? false,
    };

    instance.changeSubscriptions.add(subscription);
    if (subscription.patches) {
      instance.patchSubscriptions += 1;
    }

    return () => {
      if (!instance.changeSubscriptions.delete(subscription)) {
        return;
      }
      if (subscription.patches) {
        instance.patchSubscriptions -= 1;
      }
    };
  }) as {
    // Key-based subscribe
    <T extends SigmaDefinition, K extends Extract<keyof SigmaSignals<T>, string>>(
      publicInstance: SigmaState<T>,
      key: K,
      listener: (value: SigmaSignals<T>[K]) => void,
    ): Cleanup;

    // Root-level subscribe
    <T extends SigmaDefinition, TOptions extends SigmaSubscribeOptions | undefined = undefined>(
      publicInstance: SigmaState<T>,
      listener: SigmaChangeListener<T, TOptions extends { patches: true } ? true : false>,
      listenerOrOptions?: TOptions,
    ): Cleanup;
  },
});

async function resolveAsyncActionResult(owner: ActionOwner, result: PromiseLike<unknown>) {
  let settledValue: unknown;
  let settledError: unknown;
  let rejected = false;

  try {
    settledValue = await result;
  } catch (error) {
    rejected = true;
    settledError = error;
  }

  if (currentDraftOwner === owner && owner.currentDraft) {
    const finalized = finalizeOwnerDraft(owner);
    if (finalized?.changed) {
      // Settling with unpublished changes is the async-action footgun we want to
      // surface directly. The draft is discarded and the promise rejects here.
      const commitError = new Error(
        `[preact-sigma] Async action "${owner.actionName}" finished with unpublished changes. Call this.commit() before await or return.`,
      );
      if (rejected) {
        throw new AggregateError(
          [settledError, commitError],
          `[preact-sigma] Async action "${owner.actionName}" rejected and left unpublished changes`,
        );
      }
      throw commitError;
    }
  }

  if (rejected) {
    throw settledError;
  }

  return settledValue;
}

// oxlint-disable-next-line typescript/no-unsafe-declaration-merging
export class Sigma {
  readonly [sigmaTargetBrand] = new SigmaListenerMap();

  setup(...args: any[]): Cleanup {
    const instance = getSigmaInternals(this);

    if (!instance.type._setupFunction) {
      throw new Error("[preact-sigma] Setup is undefined for this sigma state");
    }
    if (instance.disposed) {
      throw new Error("[preact-sigma] Cannot set up a disposed sigma state");
    }
    instance.currentSetupCleanup?.();
    instance.currentSetupCleanup = undefined;

    const resources = instance.type._setupFunction.apply(
      getContext(instance, "setup"),
      args as any[],
    );
    if (!Array.isArray(resources)) {
      throw new Error("[preact-sigma] Sigma setup handlers must return an array");
    }

    let cleanup: Cleanup;
    if (resources.length) {
      let cleaned = false;
      cleanup = () => {
        if (instance.currentSetupCleanup === cleanup) {
          instance.currentSetupCleanup = undefined;
        }
        if (cleaned) return;
        cleaned = true;

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
      instance.currentSetupCleanup = cleanup;
    } else {
      cleanup = () => {};
    }

    return cleanup;
  }
}
export interface Sigma {
  readonly [sigmaStateBrand]: true;
}
Object.defineProperty(Sigma.prototype, sigmaStateBrand, {
  value: true,
});
