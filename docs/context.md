# Overview

`preact-sigma` builds reusable state models as TypeScript classes. A `Sigma<TState>` subclass owns top-level state, derived reads, writes, and setup. A `SigmaTarget<TEvents, TState>` subclass adds typed events. Each top-level state key is exposed as a reactive public property backed by a Preact signal, while actions use Immer-style mutation semantics to publish committed state.

# When to Use

- State, derived reads, mutations, and lifecycle need to stay together.
- You need multiple instances of the same model class.
- Public reads should stay reactive while writes stay explicit.
- A model needs to own timers, subscriptions, listeners, nested setup, or other cleanup-aware resources.
- Components should consume the same model shape used outside Preact.

# When Not to Use

- A few plain signals already cover the state without extra coordination.
- You want side effects to start implicitly during construction.
- The main problem is remote caching, normalization, or cross-app store tooling rather than local state behavior.
- You need ad hoc mutable objects with no benefit from typed actions, setup, or signal-backed reads.

# Core Abstractions

- Sigma class: a class that extends `Sigma<TState>` and passes its initial top-level state to `super(...)`. The `TState` argument drives helper typing for subscriptions, signals, and replacement snapshots; a same-named merged interface gives direct property reads their instance types.
- Sigma target: a class that extends `SigmaTarget<TEvents, TState>` when it also emits typed events. Use `SigmaTarget<TEvents>` for event-only targets.
- State property: a top-level key from `TState`. Each key becomes a reactive public property and has its own signal.
- Computed: an argument-free derived getter on the class prototype.
- Query: a reactive read method that accepts arguments and is marked with the `query` decorator.
- Action: a prototype method that is not marked as a query. Actions read and write through sigma's draft and commit semantics.
- Setup handler: an optional `onSetup(...)` method that owns side effects and returns cleanup resources.
- Event: a typed notification emitted with `this.emit(...)` inside an action and observed through `listen(...)` or `useListener(...)`.
- Protected view: the readonly consumer view returned by `protect(...)` and `useSigma(...)`.

# Data Flow / Lifecycle

1. Define a class that extends `Sigma<TState>` or `SigmaTarget<TEvents, TState>`.
2. Define the state as a named type, pass it to `Sigma<TState>`, then merge `interface Model extends ModelState {}` after the class so direct property reads are typed.
3. Add getters for computed values, `@query` methods for argument-based reactive reads, and ordinary methods for actions.
4. Instantiate the class. Constructor input can be merged with defaults before `super(...)` when instances need partial overrides.
5. Read state, computeds, and queries reactively from the public instance.
6. Mutate state inside actions. Synchronous actions publish automatically when they return, and sync nested actions on the same instance share one draft. Call `this.commit()` only when unpublished changes must cross a boundary, such as before an `await`, before the action promise resolves, before `emit(...)`, or before invoking another instance's action.
7. Run `setup(...)` explicitly when the instance should start owning side effects. `useSigma(...)` does this automatically for component-owned instances that define `onSetup(...)`.
8. Dispose the cleanup returned from `setup(...)` when the owned resources should stop.

# Common Tasks -> Recommended APIs

- Define reusable model state: `class Model extends Sigma<TState>`.
- Define reusable model state with events: `class Model extends SigmaTarget<TEvents, TState>`.
- Merge partial constructor input with defaults: `mergeDefaults(initial, defaults)`.
- Derive an argument-free value: a class getter.
- Derive a reactive read with arguments: an `@query` class method.
- Mutate state and emit typed notifications: ordinary class methods plus `this.emit(...)`.
- Publish unpublished changes before `await`, `emit(...)`, promise resolution, or another instance's action: `this.commit()`.
- React to committed state changes: `sigma.subscribe(instance, handler)` or `sigma.subscribe(instance, key, handler)`.
- Read one top-level state property as a `ReadonlySignal`: `sigma.getSignal(instance, key)`.
- Own timers, listeners, subscriptions, or nested setup: `onSetup(...)` plus `setup(...)`.
- Use a sigma instance inside a component: `useSigma(...)`.
- Subscribe to sigma or DOM events in a component: `useListener(...)`.
- Subscribe outside components: `listen(instance, ...)`.
- Read or restore committed top-level state: `sigma.captureState(...)` and `sigma.replaceState(...)`.

# Recommended Patterns

- Put the state shape in a named `State` type, pass it to `Sigma<TState>` or `SigmaTarget<TEvents, TState>`, then merge a same-named interface with the class for direct property typing.
- Keep frequently read values as separate top-level state properties. Each top-level key gets its own signal.
- Use getters for argument-free derived reads.
- Use `@query` for tracked reads with arguments.
- Use ordinary actions for routine writes. Reserve `sigma.captureState(...)` and `sigma.replaceState(...)` for replay, reset, restore, or undo-like flows on committed top-level state.
- Emit directly from actions that have no unpublished draft changes. After mutating state, publish first with `this.commit(); this.emit(...)`.
- Prefer `listen(...)` for external event subscriptions. It works with sigma targets and DOM targets.
- Put owned side effects in `onSetup(...)`.
- Use `sigma.subscribe(this, ...)` inside `onSetup(...)` when a setup-owned side effect should react to future committed publishes. Return that cleanup so the subscription stops with setup.
  ```ts
  onSetup() {
    return [
      sigma.subscribe(this, (nextState, baseState) => {
        console.log(baseState, nextState);
      }),
    ];
  }
  ```
- Use `this.act(function () { ... })` for setup-owned callbacks that need action semantics.

# Patterns to Avoid

- Reaching for `sigma.getSignal(instance, key)` when direct property reads already cover the use case.
- Crossing `emit(...)`, `await`, promise resolution, or another instance's action with unpublished changes. Publish them first with `this.commit()`.
- Starting side effects during construction instead of through explicit `setup(...)`.
- Encoding storage, hydration, or migration policy directly into model classes.
- Treating query calls as memoized across invocations.
- Relying on patch payloads without enabling Immer patches first.

# Invariants and Constraints

- Sigma tracks top-level state properties. Each top-level key gets its own signal.
- Protected consumer views expose immutable state and callable actions.
- Published draftable public state is deep-frozen by default. `setAutoFreeze(false)` disables that behavior globally.
- Query calls are reactive at the call site but do not memoize across invocations.
- Setup handlers return arrays of cleanup resources, and cleanup runs in reverse order.
- Call Immer's `enablePatches()` before relying on `sigma.subscribe(instance, handler, { patches: true })`.
- `sigma.replaceState(...)` works on committed top-level state and requires a plain object snapshot.
- `SigmaTarget.emit(...)` runs from an action and requires no active unpublished draft. It does not need a `commit(...)` callback.

# Error Model

- Crossing an action boundary with unpublished changes throws until `this.commit()` publishes them. Async actions also reject when they finish with unpublished changes.
- Calling `commit(...)` outside an action throws.
- Calling `act(...)` outside an `onSetup(...)` setup context throws.
- Calling `emit(...)` outside an action or before committing the active draft throws.
- `sigma.replaceState(...)` throws when the replacement value is not a plain object or when an action still owns unpublished changes.
- Starting an action on another sigma instance while the current instance has an active action context throws.

# Terminology

- Draft boundary: a point where sigma cannot keep reusing the current unpublished draft.
- Committed state: the published top-level public state visible outside the current action draft.
- Signal access: reading the underlying `ReadonlySignal` for a top-level state key through `sigma.getSignal(instance, key)`.
- Cleanup resource: a cleanup function, object with `dispose()`, or object with `[Symbol.dispose]()`.
- Nested sigma state: a sigma-state instance stored in top-level state as a value; it stays usable as a value rather than exposing its internals through parent actions.

# Non-Goals

- Replacing every plain-signal use case with a class abstraction.
- Hiding lifecycle behind implicit setup or constructor side effects.
- Memoizing every query call or turning queries into a global cache.
- Acting as a large tutorial framework or hand-maintained API reference. Exact signatures come from declaration output, and factual behavior lives beside source.
