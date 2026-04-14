import { computed } from "@preact/signals";
import {
  assertDefinitionKeyAvailable,
  buildActionMethod,
  buildQueryMethod,
  initializeSigmaInstance,
  Sigma,
  SigmaTypeInternals,
} from "./internal/runtime.js";
import { sigmaStateBrand, signalPrefix } from "./internal/symbols.js";
import type {
  ActionContext,
  AnyDefaultState,
  AnyEvents,
  AnyFunction,
  AnyResource,
  AnySigmaState,
  AnyState,
  ComputedContext,
  InitialStateInput,
  MergeObjects,
  MergeSigmaDefinition,
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
export function isSigmaState(value: object): value is AnySigmaState {
  return Boolean((value as AnySigmaState)[sigmaStateBrand]);
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

// oxlint-disable-next-line typescript/no-unsafe-declaration-merging
export abstract class SigmaTypeBuilder<
  T extends SigmaDefinition,
  TDefaults extends AnyDefaultState<Extract<T["state"], object>> = {},
> extends Function {
  /**
   * Adds top-level public state and default values to the builder.
   *
   * Each property becomes a reactive public state property on instances. Use a
   * zero-argument function when each instance needs a fresh object or array.
   */
  defaultState<TNextDefaults extends AnyDefaultState<T["state"]>>(
    defaultState: TNextDefaults,
  ): SigmaTypeBuilder<T, MergeObjects<TDefaults, TNextDefaults>> {
    const type = getTypeInternals(this);
    for (const key in defaultState) {
      if (defaultState[key] === undefined) {
        continue;
      }
      type._defaultState[key] = defaultState[key];
      type._defaultStateKeys.push(key);
    }
    return this as SigmaTypeBuilder<any, any>;
  }

  /**
   * Adds reactive getter properties for derived values that take no arguments.
   *
   * Computed names and return types are inferred from the object you pass.
   * `this` exposes readonly state plus computeds that are already on the builder.
   */
  computed<TNextComputeds extends object>(
    computeds: TNextComputeds & ThisType<ComputedContext<T, { computeds: TNextComputeds }>>,
  ): SigmaTypeBuilder<MergeSigmaDefinition<T, { computeds: TNextComputeds }>, TDefaults> {
    const type = getTypeInternals(this);
    for (const key in computeds) {
      assertDefinitionKeyAvailable(type, key, "computed");
      type._computeFunctions[key] = computeds[key] as AnyFunction;

      Object.defineProperty(this.prototype, key, {
        get: function (this: any) {
          return this[signalPrefix + key].value;
        },
      });
    }
    return this as SigmaTypeBuilder<any, any>;
  }

  /**
   * Adds reactive read methods that accept arguments.
   *
   * Query names, parameters, and return types are inferred from the object you
   * pass. Each call tracks reactively at the call site and does not memoize
   * results across invocations.
   */
  queries<TNextQueries extends object>(
    queries: TNextQueries & ThisType<ReadonlyContext<T, { queries: TNextQueries }>>,
  ): SigmaTypeBuilder<MergeSigmaDefinition<T, { queries: TNextQueries }>, TDefaults> {
    const type = getTypeInternals(this);
    for (const key in queries) {
      assertDefinitionKeyAvailable(type, key, "query");
      const queryFunction = queries[key] as AnyFunction;
      type._queryFunctions[key] = queryFunction;

      Object.defineProperty(this.prototype, key, {
        value: buildQueryMethod(queryFunction),
      });
    }
    return this as SigmaTypeBuilder<any, any>;
  }

  /**
   * Adds a committed-state observer.
   *
   * Observers run after successful publishes and can opt into Immer patches
   * with `{ patches: true }`.
   */
  observe(
    listener: (this: ReadonlyContext<T>, change: SigmaObserveChange<T["state"]>) => void,
    options?: SigmaObserveOptions & { patches?: false | undefined },
  ): this;

  observe(
    listener: (this: ReadonlyContext<T>, change: SigmaObserveChange<T["state"], true>) => void,
    options: SigmaObserveOptions & { patches: true },
  ): this;

  observe(
    listener: (this: any, change: any) => void,
    options?: SigmaObserveOptions & { patches?: boolean },
  ) {
    const type = getTypeInternals(this);
    type._observeFunctions.push(listener);
    if (options?.patches) {
      type._patchesEnabled = true;
    }
    return this;
  }

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
    actions: TNextActions & ThisType<ActionContext<T, { actions: TNextActions }>>,
  ): SigmaTypeBuilder<MergeSigmaDefinition<T, { actions: TNextActions }>, TDefaults> {
    const type = getTypeInternals(this);
    for (const key in actions) {
      assertDefinitionKeyAvailable(type, key, "action");
      const actionFunction = actions[key] as AnyFunction;
      type._actionFunctions[key] = actionFunction;

      Object.defineProperty((this as any).prototype, key, {
        value: buildActionMethod(key, actionFunction),
      });
    }
    return this as SigmaTypeBuilder<any, any>;
  }

  /**
   * Adds an explicit setup handler for side effects and owned resources.
   *
   * Every registered handler runs when `instance.setup(...)` is called, and the
   * setup argument list is inferred from the first handler you add.
   */
  setup<
    TNextSetupArgs extends [T["setupArgs"]] extends [never] ? any[] : NonNullable<T["setupArgs"]>,
  >(
    setup: (
      this: SetupContext<T, { setupArgs: TNextSetupArgs }>,
      ...args: TNextSetupArgs
    ) => readonly AnyResource[],
  ): SigmaTypeBuilder<MergeSigmaDefinition<T, { setupArgs: TNextSetupArgs }>, TDefaults> {
    const type = getTypeInternals(this);
    type._setupFunctions.push(setup);
    return this as SigmaTypeBuilder<any, any>;
  }
}

/** The constructor shape exposed by a configured sigma type. */
export interface SigmaTypeBuilder<
  T extends SigmaDefinition,
  TDefaults extends AnyDefaultState<Extract<T["state"], object>>,
> {
  /**
   * Creates a sigma-state instance.
   *
   * Constructor input shallowly overrides `defaultState(...)`. Required keys are
   * inferred from whichever state properties still do not have defaults.
   */
  new (
    ...args: InitialStateInput<T["state"], TDefaults>
  ): SigmaState<Extract<OmitEmpty<T>, SigmaDefinition>>;

  /**
   * Type-only access to the configured instance shape.
   *
   * This property does not exist at runtime. Its type is inferred from the
   * generics on `new SigmaType<TState, TEvents>()` plus the later builder inputs.
   */
  get Instance(): SigmaState<Extract<OmitEmpty<T>, SigmaDefinition>>;
}

/**
 * Builds sigma-state constructors by accumulating default state, computeds,
 * queries, observers, actions, and setup handlers.
 *
 * State and event inference starts from `new SigmaType<TState, TEvents>()`.
 * Later builder methods infer names and types from the objects you pass to them.
 */
export class SigmaType<
  TState extends AnyState,
  TEvents extends AnyEvents = {},
> extends SigmaTypeBuilder<{ state: TState; events: TEvents }> {
  constructor(name: string = "Sigma") {
    super();

    const { [name]: type } = {
      [name]: class extends Sigma {
        static _actionFunctions: Record<string, AnyFunction> = Object.create(null);
        static _computeFunctions: Record<string, AnyFunction> = Object.create(null);
        static _defaultState: Record<string, unknown> = Object.create(null);
        static _defaultStateKeys: string[] = [];
        static _observeFunctions: AnyFunction[] = [];
        static _patchesEnabled: boolean = false;
        static _queryFunctions: Record<string, AnyFunction> = Object.create(null);
        static _setupFunctions: AnyFunction[] = [];

        constructor(initialState?: AnyState) {
          super();
          initializeSigmaInstance(this, type, initialState);
        }
      },
    } satisfies {
      [name: string]: SigmaTypeInternals;
    };

    Object.setPrototypeOf(type, SigmaType.prototype);
    return type as unknown as SigmaType<TState, TEvents>;
  }
}

function getTypeInternals(type: SigmaTypeBuilder<any, any>): SigmaTypeInternals {
  return type as unknown as SigmaTypeInternals;
}
