# Migrating from v5 to v6

v6 replaces the `SigmaType` builder with class-based models. The runtime contract is still centered on top-level reactive state, derived reads, explicit actions, setup-owned side effects, typed events, and committed snapshots.

## Model Definitions

Define a class that extends `Sigma<TState>` instead of building a configured `SigmaType`.

Before:

```ts
import { SigmaType } from "preact-sigma";

const Counter = new SigmaType<{ count: number }>("Counter")
  .defaultState({
    count: 0,
  })
  .computed({
    doubled() {
      return this.count * 2;
    },
  })
  .actions({
    increment() {
      this.count += 1;
    },
  });
```

After:

```ts
import { Sigma } from "preact-sigma";

type CounterState = {
  count: number;
};

class Counter extends Sigma<CounterState> {
  constructor() {
    super({
      count: 0,
    });
  }

  get doubled() {
    return this.count * 2;
  }

  increment() {
    this.count += 1;
  }
}

interface Counter extends CounterState {}
```

`TState` drives helper typing for subscriptions, signals, and replacement snapshots. The same-named merged interface gives direct state property reads their instance types.

## Constructor Defaults

Constructor input is ordinary TypeScript now. Use `mergeDefaults(...)` when an instance accepts partial initial state.

```ts
import { mergeDefaults, Sigma } from "preact-sigma";

type SearchState = {
  draft: string;
  page: number;
};

class Search extends Sigma<SearchState> {
  static defaultState: SearchState = {
    draft: "",
    page: 1,
  };

  constructor(initialState?: Partial<SearchState>) {
    super(mergeDefaults(initialState, Search.defaultState));
  }
}

interface Search extends SearchState {}
```

## Computeds, Queries, and Actions

Use class getters for argument-free computed reads. Use ordinary prototype methods for actions. Computeds and queries read committed state, including when called inside actions.

Argument-based reactive reads are class methods marked with `@query`.

```ts
import { query, Sigma } from "preact-sigma";

type TodoListState = {
  draft: string;
};

class TodoList extends Sigma<TodoListState> {
  constructor() {
    super({ draft: "" });
  }

  @query
  canAdd(minLength: number) {
    return this.draft.trim().length >= minLength;
  }

  setDraft(draft: string) {
    this.draft = draft;
  }
}

interface TodoList extends TodoListState {}
```

## Events

`SigmaTarget` now takes event types first. Use `new SigmaTarget<TEvents>()` for standalone event-only targets, `class Model extends SigmaTarget<TEvents>` for event-only action classes, and `SigmaTarget<TEvents, TState>` for class targets that also own state.

```ts
import { listen, SigmaTarget } from "preact-sigma";

type NotificationEvents = {
  saved: {
    id: string;
  };
};

class Notifications extends SigmaTarget<NotificationEvents> {
  saved(id: string) {
    this.emit("saved", { id });
  }
}

const notifications = new Notifications();

const stop = listen(notifications, "saved", ({ id }) => {
  console.log(id);
});
```

Directly constructed `SigmaTarget` instances can emit from ordinary code. Subclasses emit inside actions. If an action mutates state before emitting, publish first with `this.commit()`.

## Commit Boundaries

Synchronous actions publish automatically when they return. Call `this.commit()` only when unpublished changes cross a boundary:

- before `await`
- before an async action promise resolves
- before `emit(...)`
- before invoking another instance's action

```ts
type SaveIndicatorState = {
  savedCount: number;
  saving: boolean;
};

type SaveIndicatorEvents = {
  saved: {
    count: number;
  };
};

class SaveIndicator extends SigmaTarget<SaveIndicatorEvents, SaveIndicatorState> {
  constructor() {
    super({
      savedCount: 0,
      saving: false,
    });
  }

  async save() {
    this.saving = true;
    this.commit();

    await Promise.resolve();

    this.savedCount += 1;
    this.saving = false;
    this.commit();

    this.emit("saved", { count: this.savedCount });
  }
}

interface SaveIndicator extends SaveIndicatorState {}
```

## Setup

Replace builder setup with an `onSetup(...)` method. Call `setup(...)` manually outside Preact, or use `useSigma(...)` for component-owned instances.

```ts
import { listen, Sigma } from "preact-sigma";

type ClickTrackerState = {
  clicks: number;
};

class ClickTracker extends Sigma<ClickTrackerState> {
  constructor() {
    super({ clicks: 0 });
  }

  onSetup(target: EventTarget) {
    return [
      listen(target, "click", () => {
        this.act(function () {
          this.clicks += 1;
        });
      }),
    ];
  }
}

interface ClickTracker extends ClickTrackerState {}
```

## Protected Views

The instance method `protect()` is gone. Use `castProtected(instance)` outside components, and use `useSigma(...)` inside components.

```ts
import { castProtected } from "preact-sigma";

const publicCounter = castProtected(new Counter());
```

Protected sigma targets keep their event metadata, so `useListener(...)` works directly with the value returned by `useSigma(...)`.

```tsx
const palette = useSigma(() => new CommandPalette());

useListener(palette, "ran", (command) => {
  console.log(command.title);
});
```

## Committed State Helpers

Replace `sigma.getState(...)` with `sigma.captureState(...)`.

```ts
const saved = sigma.captureState(todoList);

todoList.add("Ship release");
sigma.replaceState(todoList, saved);
```

Use `sigma.subscribe(instance, listener)` for committed state publishes and `sigma.subscribe(instance, key, listener)` for one top-level state key.

## Persistence

The `preact-sigma/persist` helpers are named around restore, persist, and hydrate flows:

- `restore(instance, options)`
- `restoreSync(instance, options)`
- `persist(instance, options)`
- `hydrate(instance, options)`
- `hydrateSync(instance, options)`

Use `pick: ["key"]` options for selected top-level state keys instead of a separate pick codec helper.

See [`../persist.md`](../persist.md) for persistence-specific guidance.

## More References

- [`../context.md`](../context.md): concepts, lifecycle, invariants, and API selection
- [`../../examples/basic-counter.ts`](../../examples/basic-counter.ts): minimal class model
- [`../../examples/command-palette.tsx`](../../examples/command-palette.tsx): component usage, setup, events, nested state, and custom helper objects
- `dist/index.d.mts` and `dist/persist.d.mts` after `pnpm build`: exact exported signatures
