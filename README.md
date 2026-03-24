# `framework`

Utilities for building managed UI state on top of `@preact/signals` and `immer`.

This README is derived only from [`dist/framework.d.mts`](/Users/alec/dev/sandbox/immer-test/dist/framework.d.mts).

## Overview

This module gives you a pattern for defining state with:

- a private mutable implementation
- an immutable public surface
- tracked derived values via Preact Signals
- public methods for state transitions
- optional domain-specific custom events

The public API is centered on `defineManagedState()` and `useManagedState()`.

## Exports

Runtime exports:

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

## Core Types

### `State<TState, TEvents>`

Base reactive interface shared by managed-state instances.

It provides:

- `get(key)` to access the underlying signal for an exposed state property
- `peek()` to read the current immutable public state without tracking
- `subscribe(listener)` to receive future immutable state snapshots
- `on(name, listener)` to listen for custom managed-state events

Important event detail:

- listeners receive the emitted argument directly, or no argument at all
- event payloads are never wrapped in an array at runtime

### `ManagedState<TState, TEvents, TProps>`

Public instance shape returned by `defineManagedState()` and `useManagedState()`.

It combines:

- the `State` API
- the immutable public state
- public action methods returned from the constructor

Returned signals are exposed as tracked getter properties. If the constructor returns the provided `StateHandle`, that property exposes the base state directly as an immutable value.

### `StateHandle<TState, TEvents>`

Constructor-local access to the private base state.

It provides:

- `get()` to read the current immutable base state without tracking
- `set(value)` to replace the base state or update it with an Immer producer
- `select(selector)` to derive a tracked signal from base state
- `emit(name, arg?)` to emit a domain-specific event with zero or one argument

`TState` may be any non-function value, including primitives.

The declaration comments make one intent explicit: return the handle only when you want to expose the base state directly as public immutable data. It is not intended as a composition primitive between managed states.

## `defineManagedState()`

```ts
defineManagedState(constructor, initialState)
```

Defines a managed-state class.

The constructor:

- receives a `StateHandle`
- may also receive custom constructor parameters
- must be side-effect free
- must return only methods, readonly signals, or the provided `StateHandle`

Methods returned from the constructor are automatically wrapped with `action()` from `@preact/signals`, so they are batched and untracked. In practice, actions should usually close over the provided handle instead of relying on `this`.

Returned signals are converted into getter properties, so reading them participates in Signals tracking.

### Example

```ts
import { defineManagedState } from "framework";

type CounterEvents = {
  thresholdReached: [{ count: number }];
};

const Counter = defineManagedState(
  (counter, step: number) => {
    const doubled = counter.select((count) => count * 2);

    return {
      count: counter,
      doubled,
      increment() {
        counter.set((value) => value + step);

        if (counter.get() >= 10) {
          counter.emit("thresholdReached", { count: counter.get() });
        }
      },
      reset() {
        counter.set(0);
      },
    };
  },
  0
);

const state = new Counter(2);

state.count;
state.doubled;
state.increment();

state.on("thresholdReached", (event) => {
  console.log(event.count);
});
```

In this example:

- the base state is a primitive number
- `count` is exposed by returning the `StateHandle`
- `doubled` is exposed by returning a derived signal
- `increment()` and `reset()` are public actions

## `useManagedState()`

```ts
useManagedState(constructor, initialState)
```

Hook form of the same pattern for component-local state, without defining a separate class.

The constructor rules are the same as `defineManagedState()`:

- return only methods, signals, or the `StateHandle`
- keep the constructor side-effect free

### Example

```tsx
import { useManagedState } from "framework";

function SearchBox() {
  const search = useManagedState((state) => {
    const query = state.select((value) => value.query);
    const hasQuery = state.select((value) => value.query.length > 0);

    return {
      query,
      hasQuery,
      setQuery(next: string) {
        state.set((draft) => {
          draft.query = next;
        });
      },
      clear() {
        state.set((draft) => {
          draft.query = "";
        });
      },
    };
  }, { query: "" });

  return (
    <div>
      <input
        value={search.query}
        onInput={(event) => search.setQuery(event.currentTarget.value)}
      />
      {search.hasQuery && <button onClick={() => search.clear()}>Clear</button>}
    </div>
  );
}
```

## Events

Managed-state events are for domain-specific notifications, not generic change tracking.

The declarations explicitly recommend:

- use events for meaningful domain happenings
- prefer `effect()` from `@preact/signals` for reactive responses to state changes
- use an object literal when you need to send multiple pieces of data

Event types are defined as a map from event name to a tuple with zero or one item:

```ts
type TodoEvents = {
  saved: [];
  selected: [{ id: string }];
};
```

Examples:

```ts
todo.emit("saved");
todo.emit("selected", { id: "a1" });

state.on("saved", () => {});
state.on("selected", (event) => {
  console.log(event.id);
});
```

## `useSubscribe()`

```ts
useSubscribe(target, listener)
```

Subscribes to future values from any subscribable source inside `useEffect`.

The target can be:

- a managed state
- a Preact signal
- any object with `subscribe(listener): () => void`

Behavior documented in the declarations:

- the listener is kept fresh automatically
- there is no dependency-array parameter
- pass `null` to disable the subscription temporarily

## `useEventTarget()`

```ts
useEventTarget(target, name, listener)
```

Subscribes inside `useEffect` to either:

- a DOM-style `EventTarget`
- a managed state

Behavior documented in the declarations:

- the listener is kept fresh automatically
- there is no dependency-array parameter
- pass `null` to disable the subscription temporarily

For managed-state events, the listener receives the emitted argument directly, or no argument at all.

## `isManagedState()`

```ts
isManagedState(value)
```

Runtime type guard that checks whether a value is a managed-state instance.

## `batch` and `untracked`

These are re-exported from `@preact/signals`.

Use them when you need the underlying Signals primitives directly.

## When To Use This

Use this pattern when you want:

- complex local or reusable UI state behind a constrained API
- immutable updates with Immer
- tracked derived values
- public actions that express state transitions clearly
- optional domain events for discrete business-level notifications

Skip it when plain `useState()` is enough.

## Design Rules From The Declarations

If you are writing managed state with this module, the declarations strongly imply these rules:

- base state can be any non-function value, including primitives
- constructors should be pure and side-effect free
- return only methods, signals, or the provided `StateHandle`
- use the `StateHandle` to expose base state, not to compose managed states together
- prefer actions that close over the handle instead of using `this`
- use custom events sparingly and only for domain-level notifications
