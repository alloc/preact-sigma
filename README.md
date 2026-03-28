# preact-sigma

`preact-sigma` is a typed state-model builder for apps that want Preact's fine-grained reactivity, Immer-backed writes, and explicit lifecycle.

You define a reusable state type once, then create instances wherever they make sense: inside components, in shared modules, or in plain TypeScript code. Each instance exposes readonly public state, tracked derived reads, imperative actions, and optional setup and event APIs.

## What It Is

At its core, `preact-sigma` lets you describe a stateful model as a constructor:

- top-level state stays reactive through one signal per state property
- computed values become tracked getters
- queries become tracked methods, including queries with arguments
- actions batch reads and writes through Immer drafts
- setup handlers own side effects and cleanup
- typed events let instances notify the outside world without exposing mutable internals

The result feels like a small stateful object from application code, while still behaving like signal-driven state from rendering code.

## What You Can Do With It

`preact-sigma` is useful when you want state logic to live in one reusable unit instead of being split across loose signals, reducers, and effect cleanup code.

With it, you can:

- model domain state as reusable constructors instead of one-off store objects
- read public state directly while keeping writes inside typed action methods
- derive reactive values with computed getters and parameterized queries
- publish state changes from synchronous or async actions
- observe committed state changes and optional Immer patches
- snapshot committed top-level state and replace committed state for undo-like flows
- manage timers, listeners, nested state setup, and teardown through explicit cleanup
- use the same model inside Preact components with `useSigma(...)` and `useListener(...)`

## Why This Shape Exists

This package exists to keep stateful logic cohesive without giving up signal-level reactivity.

It is a good fit when plain signals start to sprawl across modules, but heavier store abstractions feel too opaque or too tied to component structure. `preact-sigma` keeps the "model object" ergonomics of a class-like API, while preserving readonly public reads, explicit write boundaries, and explicit ownership of side effects.

## Big Picture Example

```ts
import { computed, SigmaType } from "preact-sigma";

type Todo = {
  id: string;
  title: string;
  done: boolean;
};

const TodoList = new SigmaType<
  { draft: string; todos: Todo[]; saving: boolean },
  { saved: { count: number } }
>("TodoList")
  .defaultState({
    draft: "",
    todos: [],
    saving: false,
  })
  .computed({
    // Computeds are tracked getters with no arguments.
    remainingCount() {
      return this.todos.filter((todo) => !todo.done).length;
    },
  })
  .queries({
    // Queries stay reactive at the call site and can accept arguments.
    visibleTodos(filter: "all" | "open" | "done") {
      return this.todos.filter((todo) => {
        if (filter === "open") return !todo.done;
        if (filter === "done") return todo.done;
        return true;
      });
    },
  })
  .actions({
    // Public state is readonly, so writes live in actions.
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
      this.commit(); // Publish the loading state before awaiting.

      await fetch("/api/todos", {
        method: "POST",
        body: JSON.stringify(this.todos),
      });

      this.saving = false;
      this.commit(); // Publish post-await writes explicitly.
      this.emit("saved", { count: this.todos.length });
    },
  })
  .setup(function (storageKey: string) {
    // Setup is explicit and returns cleanup resources.
    const interval = window.setInterval(() => {
      localStorage.setItem(storageKey, JSON.stringify(this.todos));
    }, 1000);

    return [() => window.clearInterval(interval)];
  });

const todoList = new TodoList();

// setup(...) returns one cleanup function for everything this instance owns.
const cleanup = todoList.setup("todos-demo");

// Queries are reactive where they are read.
const firstOpenTitle = computed(() => {
  return todoList.visibleTodos("open")[0]?.title ?? "Nothing open";
});

// Events are typed and unsubscribe cleanly.
const stop = todoList.on("saved", ({ count }) => {
  console.log(`Saved ${count} todos`);
});

todoList.setDraft("Write the README");
todoList.addTodo();
await todoList.save();

console.log(todoList.remainingCount);
console.log(firstOpenTitle.value);

stop();
cleanup();
```

In Preact, the same constructor can be used with `useSigma(() => new TodoList(), ["todos-demo"])` so the component owns one instance and `setup(...)` cleanup runs automatically. Use `useListener(...)` when you want component-scoped event subscriptions with automatic teardown.

## Best Practices

- Let `new SigmaType<TState, TEvents>()` and the builder inputs drive inference. Avoid forcing extra type arguments onto builder methods.
- Keep top-level state properties meaningful. Each top-level property gets its own signal, so shape state around the reads you want to track.
- Use `computed(...)` for argument-free derived state, and use queries for reactive reads that need parameters.
- Put writes in actions. If an async action needs to publish changes after `await`, call `this.commit()` at the points where those writes should become public.
- Use `snapshot(instance)` and `replaceState(instance, snapshot)` for committed-state replay. They work on top-level state keys and stay outside action semantics.
- Use `setup(...)` for owned side effects, and always return cleanup resources for anything the instance starts.
- Reach for `ref(...)` only when a top-level object, array, `Map`, or `Set` should intentionally stay mutable by reference.
