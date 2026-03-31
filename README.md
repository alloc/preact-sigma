# preact-sigma

`preact-sigma` lets you define state once and reuse it as a model.

It is built for Preact and TypeScript, and combines:

- fine-grained reactive reads
- Immer-style writes
- explicit setup and cleanup
- typed events
- a constructor you can instantiate anywhere

Use it when your state has started to feel like more than "some values in a component."

Instead of spreading logic across loose signals, reducers, effects, and cleanup code, you define one model with:

- top-level state
- derived reads
- write methods
- side-effect setup
- optional events

Then you create instances wherever they make sense: inside a component, in a shared module, or in plain TypeScript.

Under the hood, each top-level state property is backed by its own Preact signal, while writes happen through actions with Immer-backed mutation semantics.

## Why you would use it

`preact-sigma` is a good fit when you want state and behavior to live together.

It is especially useful when you need to:

- keep state, derived values, mutations, and lifecycle in one place
- create multiple instances of the same state model
- expose readonly public state while keeping writes explicit
- get fine-grained reactivity without wiring together a pile of loose signals
- own timers, subscriptions, listeners, or nested setup with clear cleanup

If a couple of plain signals are enough, use plain signals.  
`preact-sigma` is for the point where state starts acting like a small system.

## Install

```bash
npm install preact-sigma
```

## 30-second example

```ts
import { SigmaType } from "preact-sigma";

const Counter = new SigmaType<{ count: number }>()
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

const counter = new Counter();

counter.increment();

console.log(counter.count); // 1
console.log(counter.doubled); // 2
```

That example shows the basic shape:

- state is public and reactive
- derived values live in `computed(...)`
- writes happen in `actions(...)`
- an instance behaves like a small stateful object

## The mental model

A sigma model is made from a few simple pieces.

### `defaultState(...)`

Defines the top-level state for each instance.

Each top-level property becomes a reactive public property on the instance.

Use plain values for simple defaults, or zero-argument functions when each instance needs a fresh object or array.

### `computed(...)`

Use computeds for derived values that take no arguments.

They behave like tracked getters:

```ts
.completedCount() // no
todoList.completedCount // yes
```

### `queries(...)`

Use queries for reactive reads that need arguments.

```ts
visibleTodos("open");
```

Queries are for reading, not writing.

### `actions(...)`

Actions are where state changes happen.

Outside an action, public state is readonly. Inside an action, you write with normal mutation syntax and sigma handles the draft/update flow for you.

```ts
.actions({
  rename(title: string) {
    this.title = title;
  },
})
```

### `setup(...)`

Setup is where side effects belong.

Use it for things like:

- timers
- event listeners
- subscriptions
- nested model setup
- storage sync

Setup is explicit. A new instance does not automatically run setup. When setup does run, it returns one cleanup function that tears down everything that instance owns.

### Events

Use events when the model needs to notify the outside world without exposing mutable internals.

Emit inside actions or setup:

```ts
this.emit("saved", { count: 3 });
```

Listen from the outside:

```ts
const stop = instance.on("saved", ({ count }) => {
  console.log(count);
});
```

## A more realistic example

```ts
import { SigmaType } from "preact-sigma";

type Todo = {
  id: string;
  title: string;
  done: boolean;
};

const TodoList = new SigmaType<
  { draft: string; todos: Todo[]; saving: boolean },
  { saved: { count: number } }
>()
  .defaultState({
    draft: "",
    todos: [],
    saving: false,
  })
  .computed({
    remainingCount() {
      return this.todos.filter((todo) => !todo.done).length;
    },
  })
  .queries({
    visibleTodos(filter: "all" | "open" | "done") {
      return this.todos.filter((todo) => {
        if (filter === "open") return !todo.done;
        if (filter === "done") return todo.done;
        return true;
      });
    },
  })
  .actions({
    setDraft(draft: string) {
      this.draft = draft;
    },
    addTodo() {
      if (!this.draft.trim()) return;

      this.todos.push({
        id: crypto.randomUUID(),
        title: this.draft,
        done: false,
      });

      this.draft = "";
    },
    toggleTodo(id: string) {
      const todo = this.todos.find((todo) => todo.id === id);
      if (todo) todo.done = !todo.done;
    },
    async save() {
      this.saving = true;
      this.commit(); // publish "saving" before awaiting

      await fetch("/api/todos", {
        method: "POST",
        body: JSON.stringify(this.todos),
      });

      this.saving = false;
      this.commit(); // publish before emitting
      this.emit("saved", { count: this.todos.length });
    },
  })
  .setup(function (storageKey: string) {
    const interval = window.setInterval(() => {
      localStorage.setItem(storageKey, JSON.stringify(this.todos));
    }, 1000);

    return [() => window.clearInterval(interval)];
  });

const todoList = new TodoList();
const cleanup = todoList.setup("todos-demo");

const stop = todoList.on("saved", ({ count }) => {
  console.log(`Saved ${count} todos`);
});

todoList.setDraft("Rewrite the README");
todoList.addTodo();

console.log(todoList.remainingCount);
console.log(todoList.visibleTodos("open"));

await todoList.save();

stop();
cleanup();
```

## The one rule to remember about actions

For normal synchronous actions, mutate state and return. You usually do **not** need `this.commit()`.

Use `this.commit()` when you have unpublished changes and the action is about to cross a boundary like:

- `await`
- `emit(...)`
- another action boundary that should not keep using the current draft

In practice, that means:

- sync action with no boundary: mutate and return
- async action before `await`: `commit()` if you want those changes published first
- action before `emit(...)`: `commit()` if there are pending changes

That rule is the main thing to learn beyond the basic API.

## In Preact

`preact-sigma` works outside components, but it also has a nice component story.

Use `useSigma(...)` when the component should own one instance:

```ts
import { useSigma } from "preact-sigma";

const todoList = useSigma(() => new TodoList(), ["todos-demo"]);
```

If the model defines setup handlers, `useSigma(...)` runs setup for that component-owned instance and cleans it up automatically when setup params change or the component unmounts.

Use `useListener(...)` for component-scoped event subscriptions:

```ts
import { useListener } from "preact-sigma";

useListener(todoList, "saved", ({ count }) => {
  console.log(`Saved ${count} todos`);
});
```

## What you get out of the box

Beyond the core model API, `preact-sigma` also includes:

- `observe(...)` for reacting to committed state changes
- optional Immer patch delivery in observers
- `snapshot(...)` and `replaceState(...)` for restore/undo-like flows
- `get(key)` when you need direct signal access for a state key or computed

## Why this shape exists

`preact-sigma` exists for the space between two extremes:

- **too small for a big store abstraction**
- **too stateful for a handful of loose signals**

It keeps the ergonomics of working with a model object, while preserving:

- readonly public reads
- explicit write boundaries
- fine-grained reactivity
- explicit ownership of side effects

That makes it useful for app state that has real behavior, not just values.

## More docs

- [`llms.txt`](./llms.txt) contains the exhaustive API and behavior reference.
- Companion skills are available via `npx skills add alloc/preact-sigma`.
- The `preact-sigma` skill packages procedural guidance and agent-oriented workflow for the library.
