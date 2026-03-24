# `preact-sigma`

Managed UI state for Preact Signals, with Immer-powered updates and a small public API.

For guidance on naming, inference, and API design conventions, see [`best_practices.md`](/Users/alec/dev/sandbox/immer-test/best_practices.md).

## Big Picture

Define state once, return a few actions and derived values, and consume the result as reactive immutable data.

```ts
import { defineManagedState, type StateHandle } from "preact-sigma";

type CounterEvents = {
  thresholdReached: [{ count: number }];
};

const Counter = defineManagedState(
  (counter: StateHandle<number, CounterEvents>, step: number) => {
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

## Define Reusable State

Use `defineManagedState()` when you want a reusable managed-state class.

```ts
import { defineManagedState, type StateHandle } from "preact-sigma";

const Counter = defineManagedState(
  (counter: StateHandle<number>) => ({
    count: counter,
    increment() {
      counter.set((value) => value + 1);
    },
  }),
  0
);
```

## Expose Base State

Return the first constructor argument when you want the base state to appear as a reactive immutable property.

```ts
import { defineManagedState, type StateHandle } from "preact-sigma";

const Counter = defineManagedState(
  (count: StateHandle<number>) => ({
    count,
  }),
  0
);

new Counter().count;
```

## Derive Values

Use `.select()` to derive tracked values, then return them to expose them as getter properties.

```ts
import { defineManagedState, type StateHandle } from "preact-sigma";

const Counter = defineManagedState(
  (count: StateHandle<number>) => ({
    doubled: count.select((count) => count * 2),
  }),
  0
);

new Counter().doubled;
```

## Update State

Pass an Immer producer to `.set()` when your base state is object-shaped.

```ts
import { defineManagedState, type StateHandle } from "preact-sigma";

const Search = defineManagedState(
  (search: StateHandle<{ query: string }>) => ({
    setQuery(query: string) {
      search.set((draft) => {
        draft.query = query;
      });
    },
  }),
  { query: "" }
);
```

## Emit Events

```ts
import { defineManagedState, type StateHandle } from "preact-sigma";

type TodoEvents = {
  saved: [];
  selected: [{ id: string }];
};

const Todo = defineManagedState(
  (todo: StateHandle<{}, TodoEvents>) => ({
    save() {
      todo.emit("saved");
    },
    select(id: string) {
      todo.emit("selected", { id });
    },
  }),
  {}
);
```

## Listen For Events

Use `.on()` to subscribe to custom events from a managed state instance.

```ts
const todo = new Todo();

todo.on("saved", () => {
  console.log("saved");
});

todo.on("selected", (event) => {
  console.log(event.id);
});
```

## Read A Signal Directly

Use `.get()` when you want the underlying signal for an exposed property.

```ts
const counter = new Counter();

const countSignal = counter.get("count");
countSignal.value;
```

## Read Without Tracking

Use `.peek()` to read the current public state without creating a reactive dependency.

```ts
const counter = new Counter();

counter.peek();
```

## Subscribe To State Snapshots

Use `.subscribe()` to receive future immutable snapshots.

```ts
const counter = new Counter();

const unsubscribe = counter.subscribe((value) => {
  console.log(value.count);
});
```

## Use It Inside A Component

Use `useManagedState()` when you want the same pattern directly inside a component.

```tsx
import { useManagedState, type StateHandle } from "preact-sigma";

function SearchBox() {
  const search = useManagedState(
    (state: StateHandle<{ query: string }>) => ({
      query: state.select((value) => value.query),
      setQuery(query: string) {
        state.set((draft) => {
          draft.query = query;
        });
      },
    }),
    { query: "" }
  );

  return (
    <input
      value={search.query}
      onInput={(event) => search.setQuery(event.currentTarget.value)}
    />
  );
}
```

## Subscribe In `useEffect`

Use `useSubscribe()` with any subscribable source, including managed state and Preact signals.

```tsx
import { useSubscribe } from "preact-sigma";

useSubscribe(counter, (value) => {
  console.log(value.count);
});
```

## Listen To DOM Or Managed-State Events In `useEffect`

Use `useEventTarget()` for either DOM events or managed-state events.

```tsx
import { useEventTarget } from "preact-sigma";

useEventTarget(window, "resize", () => {
  console.log(window.innerWidth);
});
```

```tsx
useEventTarget(counter, "thresholdReached", (event) => {
  console.log(event.count);
});
```

## Reach For Signals Helpers

`batch` and `untracked` are re-exported from `@preact/signals`.

```ts
import { batch, untracked } from "preact-sigma";

batch(() => {
  counter.increment();
  counter.reset();
});

untracked(() => {
  console.log(counter.count);
});
```

## Small Feature Model

This pattern works well when a component or UI feature needs a small state model with a few public methods and derived values.

```ts
import { defineManagedState, type StateHandle } from "preact-sigma";

const Dialog = defineManagedState(
  (dialog: StateHandle<boolean>) => ({
    open: dialog,
    show() {
      dialog.set(true);
    },
    hide() {
      dialog.set(false);
    },
  }),
  false
);
```

Keep using plain `useState()` when the state is trivial.

```tsx
const [open, setOpen] = useState(false);
```
