# preact-sigma Best Practices

This file owns prescriptive guidance for `preact-sigma`. Read [../../../README.md](../../../README.md) for onboarding and [../../../llms.txt](../../../llms.txt) for the exhaustive API and terminology reference.

## Prefer Builder-Driven Inference

- Put explicit type arguments only on `new SigmaType<TState, TEvents>()`.
- Let `.defaultState(...)`, `.computed(...)`, `.queries(...)`, `.observe(...)`, `.actions(...)`, and `.setup(...)` infer from their inputs.
- Use function-valued `defaultState` properties when each instance needs a fresh object, array, or class instance.
- Use constructor input for shallow top-level overrides of defaults instead of rebuilding the full initial state shape at every call site.

## Shape State Around Reactive Reads

- Keep frequently read values as separate top-level state properties. Each top-level property gets its own signal.
- Group data under one top-level property only when consumers usually read that data together.
- Reach for `instance.get(key)` only when code specifically needs the underlying `ReadonlySignal`.

## Choose the Right Surface

- Use `.computed({ ... })` for tracked, argument-free derived state.
- Use `.queries({ ... })` for tracked reads that accept parameters.
- Keep one-off calculations local until they become reusable state-model behavior.
- Use `query(fn)` when a tracked helper is large, rarely needed, or clearer outside the sigma-state instance.

## Respect Draft Boundaries

- Put writes in `.actions({ ... })` or in `this.act(function () { ... })` inside setup.
- Treat `emit()`, `await`, and any action call other than a same-instance synchronous nested action call as draft boundaries.
- Call `this.commit()` only when pending draft changes need to become public before one of those boundaries.
- Keep non-async actions synchronous. Declare truly async actions with `async`.
- Do not expect parent actions to proxy direct mutation into a nested sigma state's internals.

## Use Setup for Owned Side Effects

- Put timers, listeners, subscriptions, and child `setup(...)` ownership in `.setup(...)`.
- Return cleanup resources for everything setup starts.
- Use `this.act(function () { ... })` when setup-owned initialization or callbacks need normal action semantics without becoming public action methods.
- Use `useSigma(...)` for component-owned instances that define setup.
- Use `useListener(...)` for component-scoped subscriptions that should clean up automatically.

## Observe and Replace State Deliberately

- Use `.observe(...)` for reactions to committed state changes, not for mid-draft logic.
- Call Immer's `enablePatches()` before relying on `{ patches: true }`.
- Use `snapshot(instance)` and `replaceState(instance, snapshot)` for replay, reset, or undo-like flows that operate on committed top-level state.
- Prefer ordinary actions for normal application writes instead of routing day-to-day updates through `replaceState(...)`.

## Opt Into Drafting and Freezing Intentionally

- Mark custom classes with `[immerable] = true` only when they should participate in Immer drafting and sigma's freeze path.
- Use `SigmaRef<T>` only to change sigma's local `Draft` and `Immutable` typing. It does not change Immer's runtime behavior.
- Use `setAutoFreeze(false)` only when later published public state intentionally needs to remain unfrozen.
