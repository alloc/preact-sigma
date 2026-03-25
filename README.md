# `preact-sigma`

Managed UI state for Preact Signals, with Immer-powered updates and a small public API.

For naming and API design conventions, see [best_practices.md](./best_practices.md).

## Big Picture

Define state once, expose a few methods, and return reactive immutable data from the public instance.

```ts
import { computed, defineManagedState, type StateHandle } from "preact-sigma";

type CounterEvents = {
  thresholdReached: [{ count: number }];
};

type CounterState = number;

const Counter = defineManagedState(
  (counter: StateHandle<CounterState, CounterEvents>, step: number) => {
    const doubled = computed(() => counter.get() * 2);

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

const counter = new Counter(2);

counter.count;
counter.doubled;
counter.increment();

counter.on("thresholdReached", (event) => {
  console.log(event.count);
});
```

## Define Reusable State

Use `defineManagedState()` when you want a reusable managed-state class.

```ts
import { defineManagedState, type StateHandle } from "preact-sigma";

type CounterState = number;

const Counter = defineManagedState(
  (counter: StateHandle<CounterState>) => ({
    count: counter,
    increment() {
      counter.set((value) => value + 1);
    },
  }),
  0
);
```

## Expose Base State

Return the constructor handle when you want the base state to appear as a reactive immutable property.

```ts
import { defineManagedState, type StateHandle } from "preact-sigma";

type CounterState = number;

const Counter = defineManagedState(
  (count: StateHandle<CounterState>) => ({
    count,
  }),
  0
);

new Counter().count;
```

## Memoize A Reactive Derivation

Use `computed()` when you want a memoized reactive value on the public instance.

```ts
import { computed, defineManagedState, type StateHandle } from "preact-sigma";

type CounterState = number;

const Counter = defineManagedState(
  (counter: StateHandle<CounterState>) => ({
    doubled: computed(() => counter.get() * 2),
  }),
  0
);

new Counter().doubled;
```

## Create A Tracked Query Method

Use `query()` when you want a public method whose reads stay tracked.

```ts
import { defineManagedState, query, type StateHandle } from "preact-sigma";

type CounterState = number;

const Counter = defineManagedState(
  (counter: StateHandle<CounterState>) => ({
    isPositive: query(() => counter.get() > 0),
  }),
  0
);

new Counter().isPositive();
```

## Read Base State Without Tracking

Use `handle.peek()` when you need the current base-state snapshot without creating a reactive dependency.

```ts
import { defineManagedState, type StateHandle } from "preact-sigma";

type CounterState = number;

const Counter = defineManagedState(
  (counter: StateHandle<CounterState>) => ({
    logNow() {
      console.log(counter.peek());
    },
  }),
  0
);
```

## Use Top-Level Lenses

When the base state is object-shaped, the constructor handle exposes a shallow lens for each top-level property, and you can return that lens directly.

```ts
import { computed, defineManagedState, type StateHandle } from "preact-sigma";

type SearchState = {
  query: string;
};

const Search = defineManagedState(
  (search: StateHandle<SearchState>) => ({
    query: search.query,
    trimmedQuery: computed(() => search.query.get().trim()),
    setQuery(query: string) {
      search.query.set(query);
    },
  }),
  { query: "" }
);

new Search().query;
```

## Compose Managed States

Return another managed-state instance when you want to expose it unchanged as a property.

```ts
import { defineManagedState, type StateHandle } from "preact-sigma";

type CounterState = number;

const Counter = defineManagedState(
  (count: StateHandle<CounterState>) => ({
    count,
    increment() {
      count.set((value) => value + 1);
    },
  }),
  0
);

type DashboardState = {
  ready: boolean;
};

const Dashboard = defineManagedState(
  (dashboard: StateHandle<DashboardState>) => ({
    dashboard,
    counter: new Counter(),
  }),
  { ready: false }
);

new Dashboard().counter.increment();
```

## Update State

Pass an Immer producer to `.set()` when your base state is object-shaped.

```ts
import { defineManagedState, type StateHandle } from "preact-sigma";

type SearchState = {
  query: string;
};

const Search = defineManagedState(
  (search: StateHandle<SearchState>) => ({
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

Use `.emit()` to publish a custom event with zero or one argument.

```ts
import { defineManagedState, type StateHandle } from "preact-sigma";

type TodoEvents = {
  saved: [];
  selected: [{ id: string }];
};

type TodoState = {};

const Todo = defineManagedState(
  (todo: StateHandle<TodoState, TodoEvents>) => ({
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

## Read Signals From A Managed State

Use `.get(key)` for one exposed property or `.get()` for the whole public state signal.

```ts
const counter = new Counter();

const countSignal = counter.get("count");
const counterSignal = counter.get();

countSignal.value;
counterSignal.value.count;
```

## Peek At Public State

Use `.peek(key)` for one exposed property or `.peek()` for the whole public snapshot.

```ts
const counter = new Counter();

counter.peek("count");
counter.peek();
```

## Subscribe To Public State

Use `.subscribe(key, listener)` for one exposed property or `.subscribe(listener)` for the whole public state.

```ts
const counter = new Counter();

const stopCount = counter.subscribe("count", (count) => {
  console.log(count);
});

const stopState = counter.subscribe((value) => {
  console.log(value.count);
});
```

## Use It Inside A Component

Use `useManagedState()` when you want the same pattern directly inside a component.

```tsx
import { useManagedState, type StateHandle } from "preact-sigma";

type SearchState = {
  query: string;
};

function SearchBox() {
  const search = useManagedState(
    (search: StateHandle<SearchState>) => ({
      query: search.query,
      setQuery(query: string) {
        search.query.set(query);
      },
    }),
    () => ({ query: "" })
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

type DialogState = boolean;

const Dialog = defineManagedState(
  (dialog: StateHandle<DialogState>) => ({
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
