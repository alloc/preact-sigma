import { computed } from "@preact/signals";
import { isDraftable } from "immer";
import { getContext, setContextPrototype } from "./internal/context.js";
import {
  assertDefinitionKeyAvailable,
  createCleanup,
  getBuilderState,
  getInternalState,
  getSignal,
  initializeSigmaInstance,
  isPlainObject,
  registerBuilderState,
  runAction,
  type SigmaTypeInternals,
} from "./internal/runtime.js";
import { sigmaRefs, sigmaStateBrand, signalPrefix } from "./internal/symbols.js";
import type {
  ActionContext,
  AnyDefaultState,
  AnyEvents,
  AnyFunction,
  AnyResource,
  AnySigmaState,
  AnyState,
  Cleanup,
  ComputedContext,
  InitialStateInput,
  MergeObjects,
  OmitEmpty,
  ReadonlyContext,
  SetupContext,
  SigmaDefinition,
  SigmaObserveChange,
  SigmaObserveOptions,
  SigmaRef,
  SigmaState,
} from "./internal/types.js";

export { action, batch, computed, effect, untracked } from "@preact/signals";
export { freeze } from "immer";

export type {
  AnyDefaultState,
  AnyEvents,
  AnyResource,
  AnySigmaState,
  AnySigmaStateWithEvents,
  AnyState,
  InferSetupArgs,
  SigmaObserveChange,
  SigmaObserveOptions,
  SigmaRef,
  SigmaState,
} from "./internal/types.js";

/** Checks whether a value is a sigma-state instance. */
export function isSigmaState(value: unknown): value is AnySigmaState {
  return Boolean(value && typeof value === "object" && (value as AnySigmaState)[sigmaStateBrand]);
}

/** Marks a draftable value so sigma keeps that top-level state value by reference. */
export function ref<T extends object>(value: T): SigmaRef<T> {
  if (!isDraftable(value)) {
    throw new Error("[preact-sigma] ref() accepts only an object that can be drafted by Immer");
  }
  sigmaRefs.add(value);
  return value as SigmaRef<T>;
}

class Sigma extends EventTarget {
  setup(...args: any[]): Cleanup {
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
setContextPrototype(Object.create(Sigma.prototype));

/** Creates a standalone tracked query function with the same signature as `fn`. */
export function query<TArgs extends any[], TResult>(fn: (this: void, ...args: TArgs) => TResult) {
  return ((...args: TArgs) => computed(() => fn(...args)).value) as typeof fn;
}

/**
 * Builds sigma-state constructors by accumulating default state, computeds, queries,
 * observers, actions, and setup handlers.
 */
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
    registerBuilderState(SigmaTypeBuilder, type);

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
      const nextQuery = queries[key] as AnyFunction;
      builderState.queries[key] = nextQuery;

      Object.defineProperty(this.prototype, key, {
        value: function (this: object, ...args: any[]) {
          const instance = getInternalState(this);
          if (instance.currentDraft) {
            return nextQuery.apply(getContext(instance, "query"), args);
          }
          return computed(() => nextQuery.apply(getContext(instance, "query"), args)).value;
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
      const nextAction = actions[key] as AnyFunction;
      builderState.actions[key] = nextAction;

      Object.defineProperty(this.prototype, key, {
        value: function (this: object, ...args: any[]) {
          const instance = getInternalState(this);
          return runAction(instance, nextAction, getContext(instance, "action"), args);
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

/** The constructor shape exposed by a configured sigma type. */
export interface SigmaType<
  TState extends AnyState,
  TEvents extends AnyEvents,
  TDefaults extends AnyDefaultState<TState>,
  TComputeds extends object,
  TQueries extends object,
  TActions extends object,
  TSetupArgs extends any[],
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
