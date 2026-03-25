# `preact-sigma`

Managed UI state for Preact Signals, with Immer-powered updates and a small public API.

For guidance on naming, inference, and API design conventions, see [`best_practices.md`](/Users/alec/dev/sandbox/immer-test/best_practices.md).

## Big Picture

Define state once, return a few actions, and keep ordinary derivations as plain functions.

```ts
import { computed, defineManagedState, type StateHandle } from "preact-sigma";

type CounterEvents = {
  thresholdReached: [{ count: number }];
};

function getDoubledCount(count: number) {
  return count * 2;
}

const Counter = defineManagedState(
  (counter: StateHandle<number, CounterEvents>, step: number) => {
    // Only expose a computed when callers benefit from a memoized reactive read.
    const doubled = computed(() => getDoubledCount(counter.get()));

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
getDoubledCount(state.count);
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

Prefer plain external functions for ordinary derivations so unused helpers can be tree-shaken.

```ts
import { defineManagedState, type StateHandle } from "preact-sigma";

function getDoubledCount(count: number) {
  return count * 2;
}

const Counter = defineManagedState(
  (count: StateHandle<number>) => ({
    count,
  }),
  0
);

const counter = new Counter();

getDoubledCount(counter.count);
```

Use `computed()` only when you need a memoized reactive derivation for performance.

```ts
import { computed, defineManagedState, type StateHandle } from "preact-sigma";

type Todo = {
  done: boolean;
};

type TodoListState = {
  filter: "all" | "active" | "done";
  todos: Todo[];
};

function getVisibleTodos(state: TodoListState) {
  if (state.filter === "active") {
    return state.todos.filter((todo) => !todo.done);
  }

  if (state.filter === "done") {
    return state.todos.filter((todo) => todo.done);
  }

  return state.todos;
}

const TodoList = defineManagedState(
  (todoList: StateHandle<TodoListState>) => ({
    state: todoList,
    visibleTodos: computed(() => getVisibleTodos(todoList.get())),
  }),
  { filter: "all", todos: [] }
);

new TodoList().visibleTodos;
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
  const model = useManagedState(
    (search: StateHandle<{ query: string }>) => ({
      search,
      setQuery(query: string) {
        search.set((draft) => {
          draft.query = query;
        });
      },
    }),
    { query: "" }
  );

  return (
    <input
      value={model.search.query}
      onInput={(event) => model.setQuery(event.currentTarget.value)}
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

`batch`, `computed`, and `untracked` are re-exported from `@preact/signals`.

```ts
import { batch, computed, untracked } from "preact-sigma";

batch(() => {
  counter.increment();
  counter.reset();
});

const doubled = computed(() => counter.count * 2);

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
