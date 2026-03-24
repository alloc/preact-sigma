# `framework`

Type-first utilities for managing complex UI state with Preact Signals and Immer.

This README is based only on [`dist/framework.d.mts`](/Users/alec/dev/sandbox/immer-test/dist/framework.d.mts), so a few usage details are inferred from the public types and doc comments.

## What It Provides

The module exports a small state-management layer built around:

- `@preact/signals` for reactivity
- `immer` for immutable updates
- event-style subscriptions for state-local notifications

The main idea is:

1. Define a piece of managed state from an initial value.
2. Inside the constructor, use a `StateHandle` to read, update, derive, and emit events.
3. Return methods and derived signals.
4. Consume the resulting object as immutable state plus public actions.

## Exports

- `defineManagedState`
- `useManagedState`
- `useSubscribe`
- `useEventTarget`
- `isManagedState`
- `batch`
- `untracked`

Type exports:

- `ManagedState`
- `StateConstructor`
- `StateHandle`
- `SubscribeTarget`

## Core Concepts

### `State`

`State<TState, TEvents>` is the base reactive interface.

It provides:

- `get(key)` to access a property as a readonly signal
- `peek()` to read the current immutable state without tracking
- `subscribe(listener)` to listen for state changes
- `on(name, listener)` to listen for named events emitted by the state manager

### `StateHandle`

`StateHandle<TState, TEvents>` is the private control surface passed into a state constructor.

It provides:

- `get()` to read the current immutable state
- `set(value)` to replace state or update it with an Immer producer
- `emit(name, ...args)` to dispatch typed events
- `select(selector)` to derive readonly signals from state

`set()` accepts either:

- a full next-state value
- an Immer `Producer<TState>`

That means updates like "mutate a draft" are expected to work.

### `ManagedState`

`ManagedState<TState, TEvents, TProps>` combines:

- the base `State` API
- the immutable state shape itself
- public methods returned from the constructor

Signals returned from the constructor are exposed as unwrapped values in the public type, not as signal objects. Functions returned from the constructor become the public action surface.

## `defineManagedState`

```ts
defineManagedState(constructor, initialState)
```

Defines a reusable managed-state class.

The constructor receives:

- `handle: StateHandle<TState, TEvents>`
- any additional constructor parameters you define

It should return an object containing only:

- functions for public methods
- readonly signals for derived values
- state handles for internal composition

Based on the declaration comments:

- state should not itself be a function
- constructor logic should be side-effect free
- returned methods are automatically wrapped so calls are batched and untracked

### Inferred Example

```ts
import { defineManagedState } from "framework";

type CounterEvents = {
  changed: [nextValue: number];
};

const CounterState = defineManagedState(
  (state, step = 1) => {
    const count = state.select((value) => value.count);

    return {
      count,
      increment() {
        state.set((draft) => {
          draft.count += step;
        });

        state.emit("changed", state.get().count);
      },
      reset() {
        state.set({ count: 0 });
        state.emit("changed", 0);
      },
    };
  },
  { count: 0 }
);

const counter = new CounterState(2);

counter.count;
counter.increment();
counter.reset();
counter.subscribe((value) => {
  console.log(value.count);
});
counter.on("changed", ([nextValue]) => {
  console.log(nextValue);
});
```

## `useManagedState`

```ts
useManagedState(constructor, initialState)
```

Hook form of `defineManagedState` for component-local state.

Use it when state transitions are substantial enough that plain `useState()` would become awkward. The declaration comments explicitly position it for complex local UI state, not trivial single-value state.

### Inferred Example

```ts
import { useManagedState } from "framework";

function Counter() {
  const counter = useManagedState((state) => {
    const count = state.select((value) => value.count);

    return {
      count,
      increment() {
        state.set((draft) => {
          draft.count += 1;
        });
      },
    };
  }, { count: 0 });

  return <button onClick={() => counter.increment()}>{counter.count}</button>;
}
```

## `useSubscribe`

```ts
useSubscribe(target, listener)
```

Subscribes to future updates from any object with a compatible `subscribe(listener)` method. This includes managed state and can include other subscribable objects that match the `SubscribeTarget<T>` type.

## `useEventTarget`

```ts
useEventTarget(target, name, listener)
```

Subscribes to events from either:

- a DOM-style `EventTarget`
- a managed state object

For managed state, event names and listener arguments are inferred from the state's event map.

## `isManagedState`

```ts
isManagedState(value)
```

Runtime type guard for detecting whether a value is one of these managed state objects.

## `batch` and `untracked`

These are re-exported directly from `@preact/signals`.

They are useful when coordinating multiple updates or reading reactive values without creating subscriptions.

## Event Typing

Events are defined as a map from event name to tuple arguments:

```ts
type TodoEvents = {
  added: [id: string];
  removed: [id: string, hardDelete?: boolean];
};
```

That shape is used by:

- `handle.emit("added", id)`
- `state.on("added", listener)`
- `useEventTarget(state, "added", listener)`

Listeners for managed-state events receive the tuple contents as arguments.

## Mental Model

Use this library when you want:

- immutable state updates
- derived reactive values
- a constrained public action API
- typed local events
- a cleaner alternative to scattering complex component state across many hooks

Avoid it when a single primitive or a couple of straightforward `useState()` calls already solve the problem.

## Assumptions And Limits

Because this documentation was written from declaration files only, these points are inferred rather than confirmed by implementation:

- how derived signals are materialized at runtime on the returned object
- whether nested `StateHandle`s are intended mainly for composition or also for public exposure
- exact subscription timing and cleanup semantics inside the React hooks
- package name and import path used in published builds

If you want stricter documentation later, the next step would be to compare this README against the runtime implementation and real usage examples.
