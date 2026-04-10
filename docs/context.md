# Overview

`preact-sigma` builds reusable state models from one definition. A configured `SigmaType` owns top-level state, derived reads, writes, setup handlers, and typed events. Each top-level state property is exposed as a reactive public property backed by its own Preact signal, while actions use Immer-style mutation semantics to publish committed state.

# When to Use

- State, derived reads, mutations, and lifecycle need to stay together.
- You need multiple instances of the same model.
- Public reads should stay reactive and readonly while writes stay explicit.
- A model needs to own timers, subscriptions, listeners, nested setup, or other cleanup-aware resources.
- Components should consume the same model shape used outside Preact.

# When Not to Use

- A few plain signals already cover the state without extra coordination.
- You want side effects to start implicitly during construction.
- The main problem is remote caching, normalization, or cross-app store tooling rather than local state behavior.
- You need ad hoc mutable objects with no benefit from typed actions, setup, or signal-backed reads.

# Core Abstractions

- Sigma type: the builder returned by `new SigmaType<TState, TEvents>()`. After configuration, it is also the constructor for instances.
- Sigma state: an instance created from a configured sigma type.
- State property: a top-level key from `TState`. Each one becomes a readonly reactive public property and gets its own signal.
- Computed: an argument-free derived getter declared with `.computed(...)`.
- Query: a reactive read that accepts arguments, declared with `.queries(...)` or built locally with `query(fn)`.
- Action: a method declared with `.actions(...)` that reads and writes through sigma's draft and commit semantics.
- Setup handler: a function declared with `.setup(...)` that owns side effects and cleanup resources explicitly.
- Event: a typed notification emitted through `this.emit(...)` and observed through `.on(...)`, `listen(...)`, or `useListener(...)`.

# Data Flow / Lifecycle

1. Define a sigma type with `new SigmaType<TState, TEvents>()`. Let later builder methods infer names and types from the objects you pass to them.
2. Add `defaultState(...)` for top-level public state and optional per-instance initializers.
3. Add `computed(...)`, `queries(...)`, and `actions(...)` for derived reads and writes.
4. Instantiate the configured type. Constructor input shallowly overrides `defaultState(...)`.
5. Read state, computeds, and queries reactively from the public instance.
6. Mutate state inside actions. Sync nested actions on the same instance share one draft. Boundaries like `await`, `emit(...)`, or separate action invocations may require `this.commit()` before the boundary.
7. Run `setup(...)` explicitly when the instance should start owning side effects. `useSigma(...)` does this automatically for component-owned instances that define setup.
8. Dispose the cleanup returned from `setup(...)` when the owned resources should stop.

# Common Tasks -> Recommended APIs

- Define reusable model state: `new SigmaType<TState, TEvents>().defaultState(...)`
- Derive an argument-free value: `.computed(...)`
- Derive a reactive read with arguments: `.queries(...)`
- Keep a tracked helper local to one consumer module: `query(fn)`
- Mutate state and emit typed notifications: `.actions(...)`
- Publish before `await`, `emit(...)`, or another action boundary: `this.commit()`
- React to committed state changes: `.observe(...)`
- Own timers, listeners, subscriptions, or nested setup: `.setup(...)`
- Use a sigma state inside a component: `useSigma(...)`
- Subscribe to sigma or DOM events in a component: `useListener(...)`
- Create a standalone typed event hub with no managed state: `new SigmaTarget<TEvents>()`, `hub.emit(...)`, and `hub.on(...)`
- Subscribe outside components: `.on(...)` or `listen(...)`
- Read or restore committed top-level state: `snapshot(...)` and `replaceState(...)`

# Practical Guidelines

- Put explicit type arguments on `new SigmaType<TState, TEvents>()` and let later builder methods infer from the objects you pass.
- Keep frequently read values as separate top-level state properties. Each top-level key gets its own signal.
- Use `.computed(...)` for argument-free derived reads.
- Use `.queries(...)` for tracked reads with arguments.
- Keep one-off calculations local until they become reusable model behavior.
- Reach for `instance.get(key)` only when code specifically needs the underlying `ReadonlySignal`.
- Treat `emit(...)`, `await`, and any action call other than a same-instance synchronous nested action call as draft boundaries. Call `this.commit()` only when pending changes need to become public before one of those boundaries.
- Use ordinary actions for routine writes. Reserve `snapshot(...)` and `replaceState(...)` for replay, reset, or undo-like flows on committed top-level state.
- Put owned side effects in `.setup(...)`.
- Use `this.act(function () { ... })` for setup-owned callbacks that need action semantics.
- Call Immer's `enablePatches()` before relying on `.observe(..., { patches: true })`.

# Invariants and Constraints

- Sigma only tracks top-level state properties. Each top-level key gets its own signal.
- Public state is readonly outside actions and `this.act(...)` inside setup.
- Duplicate names across state properties, computeds, queries, and actions are rejected at runtime. Reserved public names include `act`, `emit`, `get`, `on`, and `setup`.
- Query calls are reactive at the call site but do not memoize across invocations.
- Setup handlers return arrays of cleanup resources, and cleanup runs in reverse order.
- `replaceState(...)` works on committed top-level state and requires the exact state-key shape.
- Published draftable public state is deep-frozen by default. `setAutoFreeze(false)` disables that behavior globally.

# Error Model

- Crossing an action boundary with unpublished changes throws until `this.commit()` publishes them. Async actions also reject when they finish with unpublished changes.
- If another invocation crosses a boundary while unpublished changes still exist, sigma warns and discards those changes before continuing.
- Calling `setup(...)` on a sigma state without registered setup handlers throws.
- Cleanup rethrows an `AggregateError` when more than one cleanup resource fails.
- `replaceState(...)` throws when the replacement value is not a plain object, has the wrong top-level keys, or runs while an action still owns unpublished changes.

# Terminology

- Draft boundary: a point where sigma cannot keep reusing the current unpublished draft.
- Committed state: the published top-level public state visible outside the current action draft.
- Signal access: reading the underlying `ReadonlySignal` for a top-level state key or computed through `instance.get(key)`.
- Cleanup resource: a cleanup function, `AbortController`, object with `dispose()`, or object with `[Symbol.dispose]()`.
- Nested sigma state: a sigma-state instance stored in top-level state as a value; it stays usable as a value rather than exposing its internals through parent actions.

# Non-Goals

- Replacing every plain-signal use case with a builder abstraction.
- Hiding lifecycle behind implicit setup or constructor side effects.
- Memoizing every query call or turning queries into a global cache.
- Acting as a large tutorial framework or hand-maintained API reference. Exact signatures come from declaration output, and factual behavior lives beside source.
