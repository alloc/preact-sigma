# `preact-sigma` Best Practices

## Let The Constructor Drive Inference

Always explicitly type the first parameter of a `defineManagedState()` or `useManagedState()` constructor as `StateHandle<...>`.

When the managed state emits events, prefer declaring a separate event type alias named `${ModelName}Events` instead of writing the event map inline inside the `StateHandle` type argument.

When AI agents are generating code, also prefer declaring a `${ModelName}State` type alias before the event type alias, even if the state type is simple.

```ts
type CounterState = number;

type CounterEvents = {
  thresholdReached: [{ count: number }];
};

const CounterManager = defineManagedState(
  (count: StateHandle<CounterState, CounterEvents>) => ({
    count,
  }),
  0,
);
```

This is how the library infers the internal state and event types. Avoid specifying explicit type parameters on `defineManagedState()` or `useManagedState()` when the constructor parameter can express the same information more locally and clearly.

The extra `${ModelName}State` alias is mainly an AI-facing convention. It gives code generators the state name before they choose the handle identifier, which makes it easier for them to follow the handle naming guideline consistently.

## Name The Manager Class Clearly

Assign the value returned by `defineManagedState()` to a variable whose name ends with `Manager`, such as `TodoListManager` or `DialogManager`.

That keeps the reusable managed-state class visually distinct from the underlying state shape and from constructor-local handle names like `todoList` or `dialog`.

When you use supporting aliases, keep the unsuffixed model name for the underlying state and events.

```ts
type TodoListState = {
  filter: "all" | "active" | "done";
};

type TodoListEvents = {
  saved: [];
};

const TodoListManager = defineManagedState(
  (todoList: StateHandle<TodoListState, TodoListEvents>) => ({
    todoList,
  }),
  { filter: "all" },
);
```

## Name The Handle Precisely

When the base state is object-shaped, name the handle like an instance of the state model, such as `counter`, `search`, or `dialog`.

When the base state is not an object, avoid generic names like `state`, `handle`, or `value`. A more specific name usually makes actions and derivations easier to read.

## Keep Derivations Tree-Shakeable

For ordinary derived values, prefer external functions over properties on the managed state.

That keeps the state model focused on mutable domain behavior and lets unused derivation helpers drop out of the bundle.

```ts
function getDoubledCount(count: number) {
  return count * 2;
}

getDoubledCount(counter.count);
```

Use `computed()` only when you specifically need a memoized reactive value for performance, such as an expensive filtered list or a value the view reads many times.

```ts
const visibleTodos = computed(() => getVisibleTodos(todoList.get()));
```

## Use Top-Level Lenses For Top-Level Fields

When the base state is object-shaped, prefer the handle's top-level lenses for constructor-local reads and writes to individual fields.

That keeps simple field access terse and avoids repeating object spreads or selector boilerplate inside actions.

```ts
type SearchState = {
  query: string;
};

const SearchManager = defineManagedState(
  (search: StateHandle<SearchState>) => ({
    setQuery(query: string) {
      search.query.set(query);
    },
    clearQuery() {
      search.query.set("");
    },
  }),
  { query: "" },
);
```

## Compose Managers At Feature Boundaries

When a nested feature already has a clean public API, prefer returning that managed state instance instead of flattening both concerns into one larger model.

That keeps each managed state focused and lets callers work with the nested feature through its own methods and reactive properties.

```ts
const CounterManager = defineManagedState(
  (count: StateHandle<number>) => ({
    count,
    increment() {
      count.set((value) => value + 1);
    },
  }),
  0,
);

const DashboardManager = defineManagedState(
  (dashboard: StateHandle<{ ready: boolean }>) => ({
    dashboard,
    counter: new CounterManager(),
  }),
  { ready: false },
);
```

## Keep Public Actions Domain-Specific

Public actions should represent meaningful domain actions, not low-level mutations.

Prefer names like `save()`, `submit()`, `open()`, `close()`, or `rename()` over surgical methods like `setUpdatedAt()`. Low-level actions usually indicate that internal concerns are leaking into the public API.

## Avoid Unnecessary Binding

Managed state constructors and public actions do not use a `this` context. They work through closure over the typed `StateHandle`.

That usually means extra binding or wrapper callbacks are unnecessary when passing public actions around.

## Keep Events Domain-Specific

Custom events should describe meaningful domain happenings, not generic change notifications.

Avoid events like `"changed"` or `"updated"` when a caller really wants to react to state changes. In those cases, use `effect()` from `@preact/signals` against reactive state instead.

Custom events can carry at most one argument. When an event needs multiple pieces of data, use a single object payload.

```ts
todo.emit("selected", { id, source });
```
