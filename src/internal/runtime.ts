import { batch, computed, type ReadonlySignal, Signal, signal, untracked } from "@preact/signals";
import type { Patch } from "immer";
import * as immer from "immer";
import type { Draft, Immutable } from "../immer";
import { ContextOptions, getContext, getContextOwner, registerContextOwner } from "./context.js";
import { reservedKeys, sigmaStateBrand, signalPrefix } from "./symbols.js";
import type {
  AnyFunction,
  AnyResource,
  AnySigmaState,
  AnyState,
  Cleanup,
  SigmaState,
} from "./types.js";

export type SigmaTypeInternals = {
  actionFunctions: Record<string, AnyFunction>;
  computeFunctions: Record<string, AnyFunction>;
  defaultState: Record<string, unknown>;
  defaultStateKeys: string[];
  observeFunctions: AnyFunction[];
  patchesEnabled: boolean;
  queryFunctions: Record<string, AnyFunction>;
  setupFunctions: AnyFunction[];
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
  currentSetupCleanup?: Cleanup;
  publicInstance: AnySigmaState;
  stateKeys: Set<string>;
  type: SigmaTypeInternals;
  disposed: boolean;
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

export function isAutoFreeze() {
  return autoFreezeEnabled;
}

/** Controls whether sigma deep-freezes published public state. Auto-freezing starts enabled. */
export function setAutoFreeze(autoFreeze: boolean) {
  autoFreezeEnabled = autoFreeze;
  immer.setAutoFreeze(autoFreeze);
}

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

export function getSignal(instance: SigmaInternals, key: string) {
  return (instance.publicInstance as any)[signalPrefix + key] as ReadonlySignal<any>;
}

export function initializeSigmaInstance(
  publicInstance: AnySigmaState,
  type: SigmaTypeInternals,
  initialState: AnyState | undefined,
) {
  const stateKeys = new Set(type.defaultStateKeys);
  if (initialState) {
    for (const key in initialState) {
      stateKeys.add(key);
    }
  }

  const instance: SigmaInternals = {
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
  for (const key in type.computeFunctions) {
    Object.defineProperty(publicInstance, signalPrefix + key, {
      value: computed(() =>
        type.computeFunctions[key].call(getContext(instance, "computedReadonly")),
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
  return owner.instance.type.computeFunctions[key].call(getContext(owner, "computedDraftAware"));
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
    createDraftMetadata(draftOwner),
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
    key in builder.computeFunctions ||
    key in builder.queryFunctions ||
    key in builder.actionFunctions
  ) {
    throw new Error(`[preact-sigma] Duplicate key for ${kind}: ${key}`);
  }
}

export function shouldSetup(publicInstance: AnySigmaState): publicInstance is AnySigmaState & {
  setup(...args: any[]): Cleanup;
} {
  const instance = getSigmaInternals(publicInstance);
  return instance.type.setupFunctions.length > 0;
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
  const actionIsAsync = isAsyncFunction(actionFn);
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

function createCommitError(owner: ActionOwner) {
  return new Error(
    `[preact-sigma] Async action "${owner.actionName}" finished with unpublished changes. Call this.commit() before await or return.`,
  );
}

function createDraftMetadata(owner: ActionOwner) {
  return {
    action: owner.actionFn,
    actionArgs: owner.args,
    actionId: owner.id,
    actionName: owner.actionName,
    draftedInstance: currentDraftOwner?.publicInstance ?? owner.publicInstance,
    instance: owner.instance.publicInstance,
  };
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

function assertExactStateKeys(instance: SigmaInternals, nextState: AnyState) {
  const extraKeys = Object.keys(nextState).filter((key) => !instance.stateKeys.has(key));
  const missingKeys = [...instance.stateKeys].filter(
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

  const newState = owner.instance.type.patchesEnabled
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

  const newState = instance.type.patchesEnabled
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

function isAsyncFunction(fn: AnyFunction) {
  return fn.constructor.name === "AsyncFunction";
}

function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
  return value != null && typeof (value as PromiseLike<unknown>).then === "function";
}

function publishState(instance: SigmaInternals, finalized: FinalizedDraftResult) {
  batch(() => {
    for (const key of instance.stateKeys) {
      const nextValue = finalized.newState[key];
      if (isAutoFreeze()) {
        immer.freeze(nextValue, true);
      }
      const signal = getSignal(instance, key) as Signal<any>;
      signal.value = nextValue;
    }
  });

  for (const observer of instance.type.observeFunctions) {
    observer.call(getContext(instance, "observe"), finalized);
  }
}

/**
 * Returns a shallow snapshot of an instance's committed public state.
 *
 * The snapshot includes one own property for each top-level state key and reads
 * the current committed value for that key. Its type is inferred from the
 * instance's sigma-state definition.
 */
export function snapshot<T extends AnySigmaState>(
  publicInstance: T,
): T extends SigmaState<infer TDefinition> ? Immutable<TDefinition["state"]> : never {
  return snapshotState(getSigmaInternals(publicInstance)) as any;
}

/**
 * Replaces an instance's committed public state from a snapshot object.
 *
 * The replacement snapshot must be a plain object with exactly the instance's
 * top-level state keys. Its type is inferred from the instance's sigma-state
 * definition.
 */
export function replaceState<T extends AnySigmaState>(
  publicInstance: T,
  nextState: T extends SigmaState<infer TDefinition> ? Immutable<TDefinition["state"]> : never,
) {
  const instance = getSigmaInternals(publicInstance);
  if (!isPlainObject(nextState)) {
    throw new Error("[preact-sigma] replaceState() requires a plain object snapshot");
  }

  assertNoPendingDraft("replaceState");
  assertExactStateKeys(instance, nextState);

  const oldState = snapshot(publicInstance);
  const finalized = finalizeReplacementState(instance, oldState, nextState);
  if (finalized.changed) {
    publishState(instance, finalized);
  }
}

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
      const commitError = createCommitError(owner);
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

    const resources = instance.type.setupFunctions.flatMap((setup) => {
      const result = setup.apply(getContext(instance, "setup"), args);
      if (!Array.isArray(result)) {
        throw new Error("[preact-sigma] Sigma setup handlers must return an array");
      }
      return result;
    });

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
