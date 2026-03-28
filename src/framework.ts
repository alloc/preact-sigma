import { computed } from "@preact/signals";
import {
  assertDefinitionKeyAvailable,
  buildActionMethod,
  buildQueryMethod,
  initializeSigmaInstance,
  setRuntimeAutoFreeze,
  Sigma,
  type SigmaTypeInternals,
} from "./internal/runtime.js";
import { sigmaStateBrand, signalPrefix } from "./internal/symbols.js";
import type {
  ActionContext,
  AnyDefaultState,
  AnyEvents,
  AnyFunction,
  AnyResource,
  AnySigmaState,
  AnySigmaType,
  AnyState,
  ComputedContext,
  InitialStateInput,
  MergeObjects,
  OmitEmpty,
  ReadonlyContext,
  SetupContext,
  SigmaDefinition,
  SigmaObserveChange,
  SigmaObserveOptions,
  SigmaState,
} from "./internal/types.js";

export { action, batch, computed, effect, untracked } from "@preact/signals";
export { freeze } from "immer";
/** Re-exported from Immer so custom classes can opt into drafting with `[immerable] = true`. */
export { immerable } from "immer";

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
  SigmaState,
} from "./internal/types.js";

/** Checks whether a value is a sigma-state instance. */
export function isSigmaState(value: unknown): value is AnySigmaState {
  return Boolean(value && typeof value === "object" && (value as AnySigmaState)[sigmaStateBrand]);
}

/** Controls whether sigma deep-freezes published public state. Auto-freezing starts enabled. */
export function setAutoFreeze(autoFreeze: boolean): void {
  setRuntimeAutoFreeze(autoFreeze);
}

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
      actionFunctions: Object.create(null),
      computeFunctions: Object.create(null),
      defaultState: Object.create(null),
      defaultStateKeys: [],
      observeFunctions: [],
      patchesEnabled: false,
      queryFunctions: Object.create(null),
      setupFunctions: [],
    };

    const { [name]: SigmaTypeBuilder } = {
      [name]: class extends Sigma {
        constructor(initialState?: AnyState) {
          super();
          initializeSigmaInstance(this, type, initialState);
        }
      },
    } as unknown as {
      [name: string]: AnySigmaType;
    };

    SigmaTypeBuilder.defaultState = function (defaultState) {
      for (const key in defaultState) {
        if (defaultState[key] === undefined) {
          continue;
        }
        type.defaultState[key] = defaultState[key];
        type.defaultStateKeys.push(key);
      }
      return this;
    };

    SigmaTypeBuilder.computed = function (computeFunctions) {
      for (const key in computeFunctions) {
        assertDefinitionKeyAvailable(type, key, "computed");
        type.computeFunctions[key] = computeFunctions[key] as AnyFunction;

        Object.defineProperty(this.prototype, key, {
          get: function (this: any) {
            return this[signalPrefix + key].value;
          },
          enumerable: true,
        });
      }
      return this;
    };

    SigmaTypeBuilder.queries = function (queryFunctions) {
      for (const key in queryFunctions) {
        assertDefinitionKeyAvailable(type, key, "query");
        const queryFunction = queryFunctions[key] as AnyFunction;
        type.queryFunctions[key] = queryFunction;

        Object.defineProperty(this.prototype, key, {
          value: buildQueryMethod(queryFunction),
        });
      }
      return this;
    };

    SigmaTypeBuilder.observe = function (listener, options) {
      type.observeFunctions.push(listener);
      if (options?.patches) {
        type.patchesEnabled = true;
      }
      return this;
    };

    SigmaTypeBuilder.actions = function (actionFunctions) {
      for (const key in actionFunctions) {
        assertDefinitionKeyAvailable(type, key, "action");
        const actionFunction = actionFunctions[key] as AnyFunction;
        type.actionFunctions[key] = actionFunction;

        Object.defineProperty(this.prototype, key, {
          value: buildActionMethod(key, actionFunction),
        });
      }
      return this;
    };

    SigmaTypeBuilder.setup = function (setup) {
      type.setupFunctions.push(setup);
      return this;
    };

    return SigmaTypeBuilder as SigmaType<
      TState,
      TEvents,
      TDefaults,
      TComputeds,
      TQueries,
      TActions,
      TSetupArgs
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

  /** Does not exist at runtime, only for type inference. */
  get Instance(): SigmaState<
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

  defaultState<TNextDefaults extends AnyDefaultState<TState>>(
    defaultState: TNextDefaults,
  ): SigmaType<
    TState,
    TEvents,
    MergeObjects<TDefaults, TNextDefaults>,
    TComputeds,
    TQueries,
    TActions,
    TSetupArgs
  >;

  computed<TNextComputeds extends object>(
    computeds: TNextComputeds &
      ThisType<ComputedContext<TState, MergeObjects<TComputeds, TNextComputeds>>>,
  ): SigmaType<
    TState,
    TEvents,
    TDefaults,
    MergeObjects<TComputeds, TNextComputeds>,
    TQueries,
    TActions,
    TSetupArgs
  >;

  queries<TNextQueries extends object>(
    queries: TNextQueries &
      ThisType<ReadonlyContext<TState, TComputeds, MergeObjects<TQueries, TNextQueries>>>,
  ): SigmaType<
    TState,
    TEvents,
    TDefaults,
    TComputeds,
    MergeObjects<TQueries, TNextQueries>,
    TActions,
    TSetupArgs
  >;

  observe(
    listener: (
      this: ReadonlyContext<TState, TComputeds, TQueries>,
      change: SigmaObserveChange<TState>,
    ) => void,
    options?: SigmaObserveOptions & { patches?: false | undefined },
  ): this;

  observe(
    listener: (
      this: ReadonlyContext<TState, TComputeds, TQueries>,
      change: SigmaObserveChange<TState, true>,
    ) => void,
    options: SigmaObserveOptions & { patches: true },
  ): this;

  /**
   * Adds action methods whose `this` receives draft state, typed events, `commit()`,
   * and the computeds, queries, and actions already defined on the builder.
   *
   * Actions create drafts lazily as they need them. Sync actions on the same
   * instance reuse the current draft, so they can compose and publish once when
   * the outer action returns. Declared async actions publish their initial
   * synchronous work on return, then require `this.commit()` to publish later
   * writes made after `await`. Non-async actions stay synchronous; if one
   * returns a promise, sigma throws so async boundaries stay explicit.
   */
  actions<TNextActions extends object>(
    actions: TNextActions &
      ThisType<
        ActionContext<TState, TEvents, TComputeds, TQueries, MergeObjects<TActions, TNextActions>>
      >,
  ): SigmaType<
    TState,
    TEvents,
    TDefaults,
    TComputeds,
    TQueries,
    MergeObjects<TActions, TNextActions>,
    TSetupArgs
  >;

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
  ): SigmaType<TState, TEvents, TDefaults, TComputeds, TQueries, TActions, TNextSetupArgs>;
}
