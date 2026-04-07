import { computed } from "@preact/signals";
import {
  assertDefinitionKeyAvailable,
  buildActionMethod,
  buildQueryMethod,
  initializeSigmaInstance,
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
export { freeze, immerable } from "immer";
export { replaceState, setAutoFreeze, snapshot } from "./internal/runtime.js";

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

/** Checks whether a value is an instance created by a configured sigma type. */
export function isSigmaState(value: unknown): value is AnySigmaState {
  return Boolean(value && typeof value === "object" && (value as AnySigmaState)[sigmaStateBrand]);
}

/**
 * Creates a standalone tracked query helper with the same signature as `fn`.
 *
 * Each call is reactive at the call site and does not memoize results across
 * invocations, which makes `query(fn)` a good fit for local tracked helpers
 * that do not need to live on the sigma-state instance.
 */
export function query<TArgs extends any[], TResult>(fn: (this: void, ...args: TArgs) => TResult) {
  return ((...args: TArgs) => computed(() => fn(...args)).value) as typeof fn;
}

/**
 * Builds sigma-state constructors by accumulating default state, computeds,
 * queries, observers, actions, and setup handlers.
 *
 * State and event inference starts from `new SigmaType<TState, TEvents>()`.
 * Later builder methods infer names and types from the objects you pass to them.
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
  /**
   * Creates a sigma-state instance.
   *
   * Constructor input shallowly overrides `defaultState(...)`. Required keys are
   * inferred from whichever state properties still do not have defaults.
   */
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

  /**
   * Type-only access to the configured instance shape.
   *
   * This property does not exist at runtime. Its type is inferred from the
   * generics on `new SigmaType<TState, TEvents>()` plus the later builder inputs.
   */
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

  /**
   * Adds top-level public state and default values to the builder.
   *
   * Each property becomes a reactive public state property on instances. Use a
   * zero-argument function when each instance needs a fresh object or array.
   */
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

  /**
   * Adds reactive getter properties for derived values that take no arguments.
   *
   * Computed names and return types are inferred from the object you pass.
   * `this` exposes readonly state plus computeds that are already on the builder.
   */
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

  /**
   * Adds reactive read methods that accept arguments.
   *
   * Query names, parameters, and return types are inferred from the object you
   * pass. Each call tracks reactively at the call site and does not memoize
   * results across invocations.
   */
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

  /**
   * Adds a committed-state observer.
   *
   * Observers run after successful publishes and can opt into Immer patches
   * with `{ patches: true }`.
   */
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

  /**
   * Adds an explicit setup handler for side effects and owned resources.
   *
   * Every registered handler runs when `instance.setup(...)` is called, and the
   * setup argument list is inferred from the first handler you add.
   */
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
