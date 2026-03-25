import { useEffect, useState } from "preact/hooks";
import { useEventTarget, useSubscribe } from "preact-sigma";

import {
  FILTER_LABELS,
  STORAGE_KEY,
  canSubmitDraft,
  getCompletedCount,
  getRemainingCount,
  hasCompletedTodos,
  useTodoList,
} from "./todo-list-state";

export function App() {
  const [notice, setNotice] = useState<string | null>(null);
  const todoList = useTodoList();
  const remainingCount = getRemainingCount(todoList);
  const completedCount = getCompletedCount(todoList);
  const canCreate = canSubmitDraft(todoList);
  const canClearCompleted = hasCompletedTodos(todoList);

  // Persistence belongs outside the constructor so the state model stays pure.
  useSubscribe(todoList, (snapshot) => {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        draft: snapshot.draft,
        filter: snapshot.filter,
        todos: snapshot.todos,
      }),
    );

    document.title = `${getRemainingCount(snapshot)} left in TodoList`;
  });

  // Events work well for one-off UI feedback that should not stick in core state.
  useEventTarget(todoList, "todoAdded", (event) => {
    setNotice(`Added “${event.title}”`);
  });

  useEventTarget(todoList, "todoRemoved", (event) => {
    setNotice(`Removed “${event.title}”`);
  });

  useEventTarget(todoList, "clearedCompleted", (event) => {
    setNotice(
      `Cleared ${event.count} completed item${event.count === 1 ? "" : "s"}`,
    );
  });

  useEffect(() => {
    if (!notice) {
      return;
    }

    const timeout = window.setTimeout(() => {
      setNotice(null);
    }, 1800);

    return () => window.clearTimeout(timeout);
  }, [notice]);

  return (
    <main class="shell">
      <section class="panel">
        <header class="hero">
          <div>
            <p class="eyebrow">preact-sigma</p>
            <h1>TodoList</h1>
            <p class="lede">
              A small feature model with derived state, domain events, and
              persistence stitched together with one hook.
            </p>
          </div>
          <div class="stats" aria-label="Todo summary">
            <strong>{remainingCount}</strong>
            <span>remaining</span>
            <strong>{completedCount}</strong>
            <span>completed</span>
          </div>
        </header>

        <form
          class="composer"
          onSubmit={(event) => {
            event.preventDefault();
            todoList.submitDraft();
          }}
        >
          <label class="field">
            <span>What needs attention?</span>
            <input
              value={todoList.draft}
              onInput={(event) => todoList.setDraft(event.currentTarget.value)}
              placeholder="Ship the polished example"
            />
          </label>

          <button class="primary" type="submit" disabled={!canCreate}>
            Add Todo
          </button>
        </form>

        <section class="toolbar" aria-label="Filters">
          {(["all", "active", "done"] as const).map((filter) => (
            <button
              key={filter}
              type="button"
              class={filter === todoList.filter ? "chip chip-active" : "chip"}
              onClick={() => todoList.setFilter(filter)}
            >
              {FILTER_LABELS[filter]}
            </button>
          ))}

          <button
            type="button"
            class="ghost"
            disabled={!canClearCompleted}
            onClick={() => todoList.clearCompleted()}
          >
            Clear Completed
          </button>
        </section>

        <ul class="list">
          {todoList.visibleTodos.map((todo) => (
            <li class="item" key={todo.id}>
              <label class="checkbox">
                <input
                  type="checkbox"
                  checked={todo.done}
                  onInput={() => todoList.toggleTodo(todo.id)}
                />
                <span
                  class={
                    todo.done ? "todo-title todo-title-done" : "todo-title"
                  }
                >
                  {todo.title}
                </span>
              </label>

              <button
                type="button"
                class="remove"
                onClick={() => todoList.removeTodo(todo.id)}
                aria-label={`Remove ${todo.title}`}
              >
                Remove
              </button>
            </li>
          ))}
        </ul>

        {todoList.visibleTodos.length === 0 && (
          <p class="empty">
            {todoList.filter === "all"
              ? "No todos yet. Add the first one above."
              : "Nothing matches this filter right now."}
          </p>
        )}

        <footer class="footer">
          <span>{todoList.todos.length} total items</span>
          <span>{remainingCount} still open</span>
        </footer>
      </section>

      <aside
        class={notice ? "notice notice-visible" : "notice"}
        aria-live="polite"
      >
        {notice}
      </aside>
    </main>
  );
}
