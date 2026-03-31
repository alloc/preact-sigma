---
name: preact-sigma
description: Build, refactor, and review preact-sigma state models. Use when code imports `preact-sigma` or needs guidance on `SigmaType`, `useSigma`, typed state, `defaultState` initializers, computeds, queries, actions, observe/setup handlers, events, signal access, snapshots, listeners, or Preact integration.
---

# preact-sigma

Treat `preact-sigma` as a typed state-model builder built on top of `@preact/signals` and `immer`.

## Core Workflow

1. Start from `new SigmaType<TState, TEvents>()` and let later builder methods infer from their inputs.
2. Model reactive reads at the top level. Each top-level state property gets its own signal and readonly public property.
3. Choose APIs by role:
   - Use `.computed({ ... })` for tracked, argument-free getters.
   - Use `.queries({ ... })` for tracked reads with arguments.
   - Use `.actions({ ... })` for writes and typed event emission.
   - Use `.observe(...)` for committed-state observation.
   - Use `.setup(...)` for owned side effects and cleanup.
4. Reach for `instance.get(key)` when code needs the underlying `ReadonlySignal`.
5. Use `snapshot(instance)` and `replaceState(instance, snapshot)` only for committed top-level state flows such as replay or undo-like replacement.
6. Use `listen(...)`, `useListener(...)`, and `useSigma(...)` for sigma-state or DOM integration instead of ad hoc wiring.

## Critical Rules

- Prefer explicit type arguments only on `new SigmaType<TState, TEvents>()`.
- Treat function-valued `defaultState` properties as per-instance initializers.
- Treat builder methods as additive. They mutate the same builder and may be called in any order.
- Remember that builder method typing only sees helpers that existed when that call happened, even though runtime contexts see the full accumulated builder.
- Treat `emit()`, `await`, and any action call other than a same-instance synchronous nested action call as draft boundaries.
- Call `this.commit()` only when pending draft changes must survive an upcoming boundary.
- Keep non-async actions synchronous. If a non-async action returns a promise, sigma throws.
- Run setup explicitly. Use `this.act(function () { ... })` inside setup when setup-owned work needs normal action semantics.
- Return cleanup arrays from setup handlers. Supported resources include cleanup functions, `AbortController`, `dispose()`, and `[Symbol.dispose]()`.
- Opt into observer patches with `{ patches: true }` only after the app has called Immer's `enablePatches()`.

## Navigation

- Read [references/best-practices.md](./references/best-practices.md) for prescriptive guidance on inference, state shape, cleanup, and draft boundaries.
- Read [references/api-details.md](./references/api-details.md) for the full exported surface.
- Jump there for constructor and `defaultState` behavior, public instance shape, `observe(...)`, `setup(...)`, hooks/listeners, and advanced utilities.

## Example Pattern

```typescript
import { SigmaType } from "preact-sigma";

type Todo = {
  id: string;
  title: string;
  completed: boolean;
};

type TodoListState = {
  draft: string;
  todos: Todo[];
};

type TodoListEvents = {
  added: Todo;
};

const TodoList = new SigmaType<TodoListState, TodoListEvents>()
  .defaultState({
    draft: "",
    todos: [],
  })
  .computed({
    completedCount() {
      return this.todos.filter((todo) => todo.completed).length;
    },
  })
  .queries({
    canAddTodo() {
      return this.draft.trim().length > 0;
    },
  })
  .actions({
    setDraft(draft: string) {
      this.draft = draft;
    },
    addTodo() {
      const todo = {
        id: crypto.randomUUID(),
        title: this.draft,
        completed: false,
      };
      this.todos.push(todo);
      this.draft = "";
      this.commit(); // Needed if emit() is called, as emit() is a draft boundary
      this.emit("added", todo);
    },
  })
  .setup(function () {
    return [];
  });

const todoList = new TodoList();
```
