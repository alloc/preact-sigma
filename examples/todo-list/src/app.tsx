import { useEffect, useState } from "preact/hooks";
import {
  computed,
  type StateHandle,
  useEventTarget,
  useManagedState,
  useSubscribe,
} from "preact-sigma";

type Todo = {
  id: string;
  title: string;
  done: boolean;
};

type Filter = "all" | "active" | "done";

type TodoListState = {
  draft: string;
  filter: Filter;
  todos: Todo[];
};

type TodoEvents = {
  todoAdded: [{ title: string }];
  todoRemoved: [{ title: string }];
  clearedCompleted: [{ count: number }];
};

type TodoListHandle = StateHandle<TodoListState, TodoEvents>;
type TodoListSnapshot = ReturnType<TodoListHandle["get"]>;

const STORAGE_KEY = "preact-sigma.todo-list";

const FILTER_LABELS: Record<Filter, string> = {
  all: "All",
  active: "Active",
  done: "Done",
};

const FALLBACK_STATE: TodoListState = {
  draft: "",
  filter: "all",
  todos: [
    { id: "1", title: "Sketch the state model", done: true },
    { id: "2", title: "Wire the example with Vite", done: true },
    { id: "3", title: "Write the app like a real feature", done: false },
  ],
};

function createInitialState(): TodoListState {
  const saved = window.localStorage.getItem(STORAGE_KEY);
  if (!saved) {
    return FALLBACK_STATE;
  }
  return JSON.parse(saved) as TodoListState;
}

function nextTodoId() {
  return globalThis.crypto?.randomUUID?.() ?? `todo-${Date.now()}`;
}

function getVisibleTodos(state: TodoListSnapshot) {
  if (state.filter === "active") {
    return state.todos.filter((todo) => !todo.done);
  }

  if (state.filter === "done") {
    return state.todos.filter((todo) => todo.done);
  }

  return state.todos;
}

function getRemainingCount(state: TodoListSnapshot) {
  return state.todos.filter((todo) => !todo.done).length;
}

function getCompletedCount(state: TodoListSnapshot) {
  return state.todos.filter((todo) => todo.done).length;
}

function canSubmitDraft(state: TodoListSnapshot) {
  return state.draft.trim().length > 0;
}

function hasCompletedTodos(state: TodoListSnapshot) {
  return state.todos.some((todo) => todo.done);
}

export function App() {
  const [initialState] = useState(createInitialState);
  const [notice, setNotice] = useState<string | null>(null);

  const todoList = useManagedState((todoList: TodoListHandle) => {
    const draft = computed(() => todoList.get().draft);
    const filter = computed(() => todoList.get().filter);
    const todos = computed(() => todoList.get().todos);

    // Memoize the reactive reads the view touches repeatedly.
    const visibleTodos = computed(() => getVisibleTodos(todoList.get()));
    const remainingCount = computed(() => getRemainingCount(todoList.get()));
    const completedCount = computed(() => getCompletedCount(todoList.get()));
    const canCreate = computed(() => canSubmitDraft(todoList.get()));
    const hasCompleted = computed(() => hasCompletedTodos(todoList.get()));

    return {
      draft,
      filter,
      todos,
      visibleTodos,
      remainingCount,
      completedCount,
      canCreate,
      hasCompletedTodos: hasCompleted,
      setDraft(nextDraft: string) {
        todoList.set((state) => {
          state.draft = nextDraft;
        });
      },
      setFilter(nextFilter: Filter) {
        todoList.set((state) => {
          state.filter = nextFilter;
        });
      },
      submitDraft() {
        const title = todoList.get().draft.trim();
        if (!title) {
          return;
        }

        todoList.set((state) => {
          state.todos.unshift({
            id: nextTodoId(),
            title,
            done: false,
          });
          state.draft = "";
        });

        todoList.emit("todoAdded", { title });
      },
      toggleTodo(id: string) {
        todoList.set((state) => {
          const todo = state.todos.find((candidate) => candidate.id === id);
          if (todo) {
            todo.done = !todo.done;
          }
        });
      },
      removeTodo(id: string) {
        const todo = todoList
          .get()
          .todos.find((candidate) => candidate.id === id);
        if (!todo) {
          return;
        }

        todoList.set((state) => {
          state.todos = state.todos.filter((candidate) => candidate.id !== id);
        });

        todoList.emit("todoRemoved", { title: todo.title });
      },
      clearCompleted() {
        const count = todoList.get().todos.filter((todo) => todo.done).length;
        if (count === 0) {
          return;
        }

        todoList.set((state) => {
          state.todos = state.todos.filter((todo) => !todo.done);
        });

        todoList.emit("clearedCompleted", { count });
      },
    };
  }, initialState);

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

    document.title = `${snapshot.remainingCount} left in TodoList`;
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
            <strong>{todoList.remainingCount}</strong>
            <span>remaining</span>
            <strong>{todoList.completedCount}</strong>
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

          <button class="primary" type="submit" disabled={!todoList.canCreate}>
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
            disabled={!todoList.hasCompletedTodos}
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
          <span>{todoList.remainingCount} still open</span>
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
