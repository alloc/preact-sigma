# Changelog

All notable changes to this project will be documented in this file.

## v6.2.1

### Fixed

- **Protected subscriptions:** `sigma.subscribe(...)` now accepts protected sigma views in addition to owner instances.

## v6.2.0

### Added

- **`useSigmaSync` hook:** Synchronizes changed external data into a sigma instance after the initial render. Accepts a plain object with stable keys, shallow-compares values with `Object.is(...)`, and runs the sync callback only when at least one value changes.

## v6.1.4

### Fixed

- **`captureState(...)` accepts protected views:** `sigma.captureState(...)` now accepts a `Protected<Sigma<TState>>` in addition to the owner instance.

## v6.1.3

### Fixed

- **Immutable initial state:** Sigma constructors now accept a `Readonly<TState>` or `DeepReadonly<TState>` value as the initial state argument.

## v6.1.2

### Fixed

- **Immutable `replaceState(...)` snapshots:** `sigma.replaceState(...)` now accepts readonly snapshot objects.

## v6.1.1

### Fixed

- **Protected views are readonly:** `Protected<T>` now enforces deep readonly on all state properties.
- **Persist helpers accept protected views:** `restoreState(...)`, `persistState(...)`, and related helpers now accept a `Protected<>` view in addition to the owner instance.

## v6.1.0

### Added

- **Standalone sigma targets:** Directly constructed `SigmaTarget<TEvents>` instances can emit typed events from ordinary code.

## v6.0.2

### Internal Improvements

- **Documentation:** Clarified sigma runtime semantics and private-field behavior in reference docs.

## v6.0.1

### Added

- **Private class fields:** Class models support ECMAScript `#fields` for ephemeral instance storage that is not signal-backed, captured, or persisted by sigma.

### Internal Improvements

- **Draft diagnostics:** External-action draft errors include the active draft owner class name.

## v6.0.0

### Breaking Changes

- **Class-based models replace the `SigmaType` builder:** Models now extend `Sigma<TState>` or `SigmaTarget<TEvents, TState>`.
- **Derived reads move to class members:** Computeds are class getters, argument-based reads use `@query`, and prototype methods are actions by default.
- **Committed-state helpers changed:** Committed snapshots now use `sigma.captureState(...)`, paired with `sigma.replaceState(...)`.
- **Protected views changed:** Use `castProtected(instance)` outside components and `useSigma(...)` inside components.
- **Persistence helper names changed:** The `preact-sigma/persist` helpers now use restore, hydrate, persist, and pick naming.

### Added

- **Class model runtime:** `Sigma`, `SigmaTarget`, actions, computed getters, and `@query` support the v6 class API.
- **Default-state helper:** `mergeDefaults(...)` applies constructor overrides over default state.
- **Readonly consumer helpers:** `Protected<T>` and `castProtected(...)` expose the public readonly view used by `useSigma(...)`.

## v5.0.0

### Breaking Changes

- **Committed-state helpers moved under `sigma`:** The standalone `snapshot(...)` and `replaceState(...)` exports have been replaced by `sigma.getState(...)` and `sigma.replaceState(...)`. Signal access also moves from `instance.get(key)` to `sigma.getSignal(instance, key)`.
- **Committed-state observation moved off `SigmaType`:** `SigmaType.observe(...)` has been removed. Observe publishes from an instance with `sigma.subscribe(instance, listener, options)` instead, or subscribe to one top-level state property or computed with `sigma.subscribe(instance, key, listener)`.
- **Sigma events are no longer based on `EventTarget`:** Sigma-state instances and `SigmaTarget` no longer inherit from `EventTarget`. Direct `addEventListener(...)`, `removeEventListener(...)`, `dispatchEvent(...)`, and `instance.on(...)` usage must move to `listen(...)`, `useListener(...)`, `this.emit(...)` inside sigma actions, or `SigmaTarget.emit(...)` and `SigmaTarget.on(...)`.
- **Observer type names changed:** `SigmaObserveChange` is now `SigmaChange`, and `SigmaObserveOptions` is now `SigmaSubscribeOptions`.

### Added

- **Persistence helpers:** `preact-sigma/persist` is a new subpath export for committed-state restore and persistence. It includes `restoreState(...)`, `restoreStateSync(...)`, `persistState(...)`, `bindPersistence(...)`, `bindPersistenceSync(...)`, and `pickStateCodec(...)`.
- **Convenience re-exports:** The root package now re-exports `action` and `effect` from `@preact/signals`, plus `immerable` from `immer`.

### Internal Improvements

- **Listener model cleanup:** `listen(...)`, `useListener(...)`, sigma states, and `SigmaTarget` now share one typed listener registry instead of relying on DOM event objects for sigma-specific events.
- **Helper typing cleanup:** The public helper surface is simpler and more consistent around `sigma.getSignal(...)`, `sigma.getState(...)`, `sigma.replaceState(...)`, and `sigma.subscribe(...)`.

### Migration Guide

- Replace `snapshot(instance)` with `sigma.getState(instance)`.
- Replace `replaceState(instance, nextState)` with `sigma.replaceState(instance, nextState)`.
- Replace `instance.get(key)` with `sigma.getSignal(instance, key)`.
- Replace `type.observe(listener, options)` with `sigma.subscribe(instance, listener, options)` after creating the instance.
- Replace `instance.on(name, listener)` and direct `EventTarget` usage on sigma objects with `listen(instance, name, listener)` or `SigmaTarget.on(name, listener)`.
- Import persistence helpers from `preact-sigma/persist` when storage, restore sequencing, or partial persistence should stay outside the `SigmaType` definition.

## v4.0.0

### Breaking Changes

- **Peer Dependencies:** `preact`, `@preact/signals`, and `immer` are now peer dependencies instead of direct dependencies. You must ensure they are installed in your project alongside `preact-sigma`.

## v3.0.0

### Breaking Changes

- **Simplified `SigmaType` Generics:** The internal and public type signatures for `SigmaType` and its related contexts (`ActionContext`, `ReadonlyContext`, etc.) have been refactored to use a single `SigmaDefinition` object instead of multiple individual type parameters.
  - While this is largely an internal refactor to improve maintainability and reduce type complexity, any manual usage of the `SigmaType` or context types in your own code (e.g., `SigmaType<State, Events, ...>`) will need to be updated to the new structure.
  - The `AnySigmaType` utility type no longer takes multiple `any` arguments and is now simplified to `AnySigmaType`.

### Internal Improvements

- **Improved Type Merging:** Incremental builder methods like `.computed()`, `.queries()`, and `.actions()` now use a more robust merging strategy, reducing the risk of type degradation in complex models.
- **Refined `MergeObjects`:** The internal utility for merging state and definition objects is now more reliable when dealing with optional properties.

### Migration Guide

If you are using the `SigmaType` builder pattern (e.g., `new SigmaType<{ count: number }>("Counter")...`), no changes are required to your runtime code.

If you have manually annotated variables or functions with `SigmaType` or its context types, you must update the generic arguments:

**Before:**

```ts
function myHelper(ctx: ActionContext<MyState, MyEvents, MyComputeds, MyQueries, MyActions>) { ... }
```

**After:**

```ts
import { ActionContext, SigmaDefinition } from "preact-sigma";

type MyDefinition = {
  state: MyState;
  events: MyEvents;
  computeds: MyComputeds;
  queries: MyQueries;
  actions: MyActions;
};

function myHelper(ctx: ActionContext<MyDefinition>) { ... }
```
