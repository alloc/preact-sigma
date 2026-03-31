# preact-sigma API Details

This file contains the extended behavioral reference for `preact-sigma`. Use it when `SKILL.md` is not enough.

## Table of Contents

- [Runtime Exports](#runtime-exports)
- [Type Exports](#type-exports)
- [Inference](#inference)
- [SigmaType](#sigmatype)
- [Public Instance Shape](#public-instance-shape)
- [Reactivity Model](#reactivity-model)
- [get(key)](#getkey)
- [computed](#computed)
- [queries](#queries)
- [actions](#actions)
- [observe](#observe)
- [setup](#setup)
- [Events](#events)
- [Advanced Utilities](#advanced-utilities)
- [Passthrough Exports](#passthrough-exports)
- [Hooks & Listeners](#hooks--listeners)

## Runtime Exports

Import runtime APIs from `preact-sigma`.

```typescript
import {
  SigmaType,
  action,
  batch,
  computed,
  effect,
  freeze,
  immerable,
  isSigmaState,
  listen,
  query,
  type SigmaRef,
  replaceState,
  setAutoFreeze,
  snapshot,
  untracked,
  useListener,
  useSigma,
} from "preact-sigma";
```

## Type Exports

- `AnyDefaultState`: Describes the object accepted by `.defaultState(...)`.
- `AnyEvents`: Describes an event map from event names to payload objects or `void`.
- `AnyResource`: Describes a supported setup cleanup resource, including cleanup functions, `AbortController`, objects with `dispose()`, and objects with `Symbol.dispose`.
- `AnySigmaState`: Describes the public shape shared by all sigma-state instances.
- `AnySigmaStateWithEvents`: Describes a sigma-state instance with a typed event map.
- `AnyState`: Describes the top-level state object for a sigma type.
- `InferEventType`: Infers the supported event names for a target used with `listen(...)` or `useListener(...)`.
- `InferListener`: Infers the listener signature for a target and event name.
- `InferSetupArgs`: Infers the `setup(...)` argument list for a sigma-state instance.
- `SigmaObserveChange`: Describes the object received by `.observe(...)` listeners.
- `SigmaObserveOptions`: Describes the options object accepted by `.observe(...)`.
- `SigmaState`: Describes the public instance shape produced by a configured sigma type.

## Inference

- `TState` and `TEvents` come from `new SigmaType<TState, TEvents>()`.
- `defaultState` comes from `.defaultState(...)`, where each property may be either a value or a zero-argument initializer that returns the value.
- Public computed names and return types come from `.computed(...)`.
- Public query names, parameter types, and return types come from `.queries(...)`.
- `observe(change)` types come from `.observe(...)`, and `patches` and `inversePatches` are present only when that call uses `{ patches: true }`.
- Public action names, parameter types, and return types come from `.actions(...)`.
- `setup(...args)` argument types come from the first `.setup(...)` call and later setup calls reuse that same argument list.
- `get(key)` signal types come from `TState` and from computed return types.
- Prefer explicit type arguments only on `new SigmaType<TState, TEvents>()`. Let builder methods infer from their inputs.

## SigmaType

`new SigmaType<TState, TEvents>()` creates a mutable, reusable sigma-state builder that is also the constructor for sigma-state instances after configuration.

Behavior:

- `.defaultState(...)`, `.setup(...)`, `.computed(...)`, `.queries(...)`, `.observe(...)`, and `.actions(...)` all mutate the same builder and return it.
- Builder methods are additive and may be called in any order.
- Builder method typing only exposes helpers that existed when that builder call happened.
- Runtime contexts use the full accumulated builder, including definitions added later.
- `defaultState` is optional and must be a plain object when provided.
- Function-valued `defaultState` properties act as per-instance initializers.
- Constructor input must be a plain object when provided.
- Constructor input shallowly overrides `defaultState`.
- If every required state property is covered by `defaultState`, constructor input is optional.
- Duplicate names across state properties, computeds, queries, and actions are rejected at runtime.
- Reserved public names are `act`, `get`, `setup`, `on`, and `emit`.

## Public Instance Shape

A sigma-state instance exposes:

- one readonly enumerable own property for every state property
- one tracked non-enumerable getter for every computed
- one method for every query
- one method for every action
- `get(key): ReadonlySignal<...>` for state-property and computed keys
- `setup(...args): () => void` when the builder has at least one setup handler
- `on(name, listener): () => void`
- `Object.keys(instance)` includes only top-level state properties

## Reactivity Model

- each top-level state property is backed by its own Preact signal
- public state reads are reactive
- signal access is reactive, so reading `.value` tracks like any other Preact signal read
- computed getters are reactive and lazily memoized
- queries are reactive at the call site, including queries with arguments
- query calls are not memoized across invocations; each call uses a fresh `computed(...)` wrapper and does not retain that signal

## get(key)

`instance.get(key)` returns the underlying `ReadonlySignal` for one top-level state property or computed.

Behavior:

- state-property keys return that property's signal
- computed keys return that computed getter's signal

## computed

Computeds are added with `.computed({ ... })`.

Behavior:

- each computed is exposed as a tracked getter property
- computed getters are non-enumerable on the public instance
- `this` inside a computed exposes readonly state plus other computeds
- computeds do not receive query or action methods on `this`
- computeds cannot accept arguments

## queries

Queries are added with `.queries({ ... })`.

Behavior:

- queries may accept arbitrary parameters
- `this` inside a query exposes readonly state, computeds, and other queries
- queries do not receive action methods on `this`
- when a query runs inside an action, it reads from the current draft-aware state
- query results are reactive at the call site but are not memoized across calls
- prefer `.queries({ ... })` for commonly needed instance methods
- use `query(fn)` when a tracked helper is large, rarely needed, or better kept local to a consumer module
- query wrappers are shared across instances
- query typing only exposes computeds and queries that were already present when its `.queries(...)` call happened

## actions

- actions create drafts lazily when reads or writes need draft-backed mutation semantics
- actions may call other actions, queries, and computeds
- same-instance sync nested action calls reuse the current draft
- any other action call starts a different invocation and is a draft boundary
- `emit()` is a draft boundary
- `await` inside an async action is a draft boundary
- `this.commit()` publishes the current draft immediately
- `this.commit()` is only needed when the current action has unpublished draft changes and is about to cross a draft boundary
- a synchronous action does not need `this.commit()` when it finishes without crossing a draft boundary
- declared async actions publish their initial synchronous draft on return
- after an async action resumes from `await`, top-level reads of draftable state and state writes may open a hidden draft for that async invocation
- non-async actions must stay synchronous; if one returns a promise, sigma throws
- if an async action reaches `await` or `return` with unpublished changes, the action promise rejects when it settles
- if an action crosses a boundary while it owns unpublished changes, sigma throws until `this.commit()` publishes them
- if a different invocation crosses a boundary while unpublished changes still exist, sigma warns and discards them before continuing
- successful publishes deep-freeze draftable public state and write it back to per-property signals while auto-freezing is enabled
- custom classes participate in Immer drafting only when the class opts into drafting with `[immerable] = true`
- actions can emit typed events with `this.emit(...)`
- action wrappers are shared across instances
- action typing only exposes computeds, queries, and actions that were already present when its `.actions(...)` call happened

Nested sigma states stored in state stay usable as values. Actions do not proxy direct mutation into a nested sigma state's internals.

## observe

Observers are added with `.observe(listener, options?)`.

Behavior:

- each observer runs after a successful action commit that changes base state
- observers do not run for actions that leave base state unchanged
- `change.newState` is the committed base-state snapshot for that action
- `change.oldState` is the base-state snapshot from before that action started
- `this` inside an observer exposes readonly state, computeds, and queries
- observers do not receive action methods or `emit(...)` on `this`
- same-instance sync nested action calls produce one observer notification after the outer action commits
- patch generation is opt-in with `{ patches: true }`
- when patch generation is enabled, `change.patches` and `change.inversePatches` come from Immer
- applications are responsible for calling Immer's `enablePatches()` before using observer patch generation
- observer typing only exposes computeds and queries that were already present when that `.observe(...)` call happened

## setup

Setup is added with `.setup(fn)`.

Behavior:

- setup is explicit; a new instance does not run setup automatically
- each `.setup(...)` call adds another setup handler
- `useSigma(...)` calls `.setup(...)` for component-owned instances that define setup
- calling `.setup(...)` again cleans up the previous setup first
- one `.setup(...)` call runs every registered setup handler in definition order
- the public `.setup(...)` method always returns one cleanup function
- `this` inside a setup handler exposes the public instance plus `emit(...)` and `act(fn)`
- `this.act(fn)` inside setup runs `fn` with normal action semantics without adding a public action method
- use `this.act(fn)` for setup-time initialization work or setup-owned callbacks that need action semantics
- pass a normal `function () {}` to `this.act(...)` so callback `this` receives the action context
- `this.act(fn)` callbacks must stay synchronous
- each setup handler returns an array of cleanup resources
- cleanup runs in reverse order, and multiple cleanup failures are rethrown as an `AggregateError`
- setup typing only exposes computeds, queries, and actions that were already present when that `.setup(...)` call happened

Supported cleanup resources:

- cleanup functions
- objects with `dispose()`
- objects with `[Symbol.dispose]()`
- `AbortController`

When a parent setup wants to own a nested sigma state's setup, call the child sigma state's `setup(...)` method and return that cleanup function.

## Events

Events are emitted from actions or setup through `this.emit(name, payload?)`.

Behavior:

- the event map controls allowed event names and payload types
- `void` events emit no payload
- object events emit one payload object
- `.on(name, listener)` returns an unsubscribe function
- listeners receive the payload directly, or no argument for `void` events

## Advanced Utilities

- **`immerable`**: Re-exported from Immer so custom classes can opt into drafting with `[immerable] = true`. Unmarked custom class instances stay outside sigma's Immer drafting and freeze path.
- **`SigmaRef<T>`**: A type brand that keeps a value by reference in sigma's local `Draft` and `Immutable` helpers. Assigning to a `SigmaRef<T>`-typed value changes typing only and has no runtime effect.
- **`query(fn)`**: Creates a standalone tracked query helper with the same parameter and return types as `fn`. Calls are reactive but not memoized across invocations.
- **`setAutoFreeze(autoFreeze)`**: Controls whether sigma deep-freezes published public state at runtime. Auto-freezing starts enabled and the setting is shared across instances.
- **`snapshot(instance)`**: Returns a shallow snapshot of committed top-level public state. It excludes computeds, queries, actions, events, and setup helpers, and does not recurse into nested sigma states.
- **`replaceState(instance, snapshot)`**: Replaces committed public state from a plain snapshot object with exactly the instance's top-level state keys. It notifies observers when committed state changes and throws if an action still owns unpublished changes.

## Passthrough Exports

- `action`, `batch`, `computed`, `effect`, and `untracked` are re-exported from `@preact/signals`.
- `freeze` is re-exported from `immer`. Frozen objects cannot be mutated through Immer drafts, including inside sigma actions.

## Hooks & Listeners

### useSigma

`useSigma(create, setupParams?)` creates one sigma-state instance for a component and manages setup cleanup.

Behavior:

- calls `create()` once per mounted component instance
- returns the same sigma-state instance for the component lifetime
- if the sigma state defines setup, calls `sigmaState.setup(...setupParams)` in an effect
- reruns setup when `setupParams` change
- the cleanup returned by `setup(...)` runs when `setupParams` change or when the component unmounts

### listen

`listen(target, name, listener)` adds an event listener and returns a cleanup function.

Behavior:

- it subscribes with `addEventListener(...)` and returns a cleanup function that removes that listener
- for sigma-state targets, the listener receives the typed payload directly
- for DOM targets, the listener receives the typed DOM event object

### useListener

`useListener(target, name, listener)` attaches an event listener inside a component.

Behavior:

- subscribes in `useEffect`
- unsubscribes automatically when `target` or `name` changes or when the component unmounts
- keeps the latest listener callback without requiring it in the effect dependency list
- passing `null` disables the listener

### isSigmaState

`isSigmaState(value)` checks whether a value is a sigma-state instance.
