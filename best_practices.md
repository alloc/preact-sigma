# `preact-sigma` Best Practices

## Let The Constructor Drive Inference

Always explicitly type the first parameter of a `defineManagedState()` or `useManagedState()` constructor as `StateHandle<...>`.

When the managed state emits events, prefer declaring a separate event type alias named `${ModelName}Events` instead of writing the event map inline inside the `StateHandle` type argument.

Declare the `${ModelName}State` type alias immediately before the `defineManagedState()` call, even if the state type is simple.

```ts
type CounterEvents = {
  thresholdReached: [{ count: number }];
};

type CounterState = number;

const Counter = defineManagedState(
  (count: StateHandle<CounterState, CounterEvents>) => ({
    count,
  }),
  0,
);
```

This is how the library infers the internal state and event types. Avoid specifying explicit type parameters on `defineManagedState()` or `useManagedState()` when the constructor parameter can express the same information more locally and clearly.

That keeps the state type easy to reference from the constructor's `StateHandle` and makes the nearby type information easier to scan.

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

const Search = defineManagedState(
  (search: StateHandle<SearchState>) => ({
    query: search.query,
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

Return the top-level lens itself when one public field should stay reactive without exposing the whole base state.

Spread an object-shaped handle into the returned object when the public managed state should mirror the base state's top-level shape.

```ts
type SearchState = {
  page: number;
  query: string;
};

const Search = defineManagedState(
  (search: StateHandle<SearchState>) => ({
    ...search,
    nextPage() {
      search.page.set((page) => page + 1);
    },
  }),
  { page: 1, query: "" },
);
```

## Use `query()` For Tracked Public Reads

Returned methods are action-wrapped by default. When a public method is conceptually a read, tag it with `query()` so its body participates in signal tracking.

That keeps read-style methods reactive without turning ordinary mutating actions into tracked code.

```ts
const Counter = defineManagedState(
  (counter: StateHandle<number>) => ({
    isPositive: query(() => counter.get() > 0),
  }),
  0,
);
```

## Compose Managed States At Feature Boundaries

When a nested feature already has a clean public API, prefer returning that managed state instance instead of flattening both concerns into one larger model.

That keeps each managed state focused and lets callers work with the nested feature through its own methods and reactive properties.

```ts
type CounterState = number;

const Counter = defineManagedState(
  (count: StateHandle<CounterState>) => ({
    count,
    increment() {
      count.set((value) => value + 1);
    },
  }),
  0,
);

type DashboardState = {
  ready: boolean;
};

const Dashboard = defineManagedState(
  (dashboard: StateHandle<DashboardState>) => ({
    dashboard,
    counter: new Counter(),
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
