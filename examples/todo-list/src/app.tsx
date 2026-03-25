import { Trash2 } from "lucide-react";
import { useManagedState, type StateHandle } from "preact-sigma";

type TodoItem = {
  id: string;
  title: string;
  completed: boolean;
};

type TodoListState = {
  draft: string;
  items: TodoItem[];
};

function createId() {
  if (
    typeof crypto !== "undefined" &&
    typeof crypto.randomUUID === "function"
  ) {
    return crypto.randomUUID();
  }

  return `todo-${Math.random().toString(36).slice(2, 10)}`;
}

function createTodo(title: string): TodoItem {
  return {
    id: createId(),
    title,
    completed: false,
  };
}

function createInitialItems(): TodoItem[] {
  return [
    createTodo("Sketch the day"),
    { ...createTodo("Ship the smallest useful version"), completed: true },
    createTodo("Review the result with fresh eyes"),
  ];
}

function getOpenTodoCount(items: readonly TodoItem[]) {
  return items.reduce((count, item) => count + (item.completed ? 0 : 1), 0);
}

export function App() {
  const todoList = useManagedState(
    (todoList: StateHandle<TodoListState>) => ({
      draft: todoList.draft,
      items: todoList.items,
      setDraft(nextDraft: string) {
        todoList.draft.set(nextDraft);
      },
      addTodo() {
        const title = todoList.draft.get().trim();

        if (!title) {
          return;
        }

        todoList.items.set((items) => {
          items.push(createTodo(title));
        });
        todoList.draft.set("");
      },
      toggleTodo(id: string) {
        todoList.items.set((items) => {
          const todo = items.find((item) => item.id === id);

          if (todo) {
            todo.completed = !todo.completed;
          }
        });
      },
      removeTodo(id: string) {
        todoList.items.set((items) => {
          const index = items.findIndex((item) => item.id === id);

          if (index >= 0) {
            items.splice(index, 1);
          }
        });
      },
    }),
    () => ({
      draft: "",
      items: createInitialItems(),
    }),
  );

  const canAddTodo = todoList.draft.trim().length > 0;
  const openTodoCount = getOpenTodoCount(todoList.items);
  const totalTodoCount = todoList.items.length;

  return (
    <main class={totalTodoCount === 0 ? "todo-page is-empty" : "todo-page"}>
      <section class="todo-card" aria-labelledby="todo-title">
        <header class="todo-header">
          <div>
            <p class="todo-kicker">preact-sigma demo</p>
            <h1 id="todo-title">Todo list</h1>
          </div>
          <p class="todo-badge" aria-label={`${openTodoCount} open todos`}>
            {openTodoCount} open
          </p>
        </header>

        <form
          class="todo-form"
          onSubmit={(event) => {
            event.preventDefault();
            todoList.addTodo();
          }}
        >
          <label class="todo-field">
            <span class="sr-only">Add a todo</span>
            <input
              class="todo-input"
              type="text"
              value={todoList.draft}
              onInput={(event) => todoList.setDraft(event.currentTarget.value)}
              placeholder="Add a task"
              autoComplete="off"
              spellcheck={false}
            />
          </label>
          <button class="todo-submit" type="submit" disabled={!canAddTodo}>
            Add
          </button>
        </form>

        {totalTodoCount > 0 ? (
          <ul class="todo-list" aria-label="Todos">
            {todoList.items.map((todo) => (
              <li
                key={todo.id}
                class={todo.completed ? "todo-item is-completed" : "todo-item"}
              >
                <label class="todo-toggle-wrap">
                  <input
                    class="todo-toggle"
                    type="checkbox"
                    checked={todo.completed}
                    onChange={() => todoList.toggleTodo(todo.id)}
                  />
                  <span class="todo-title">{todo.title}</span>
                </label>
                <button
                  class="todo-delete"
                  type="button"
                  onClick={() => todoList.removeTodo(todo.id)}
                  aria-label={`Delete ${todo.title}`}
                >
                  <Trash2 aria-hidden="true" size={16} strokeWidth={2} />
                  <span class="sr-only">Delete</span>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <div class="todo-empty" role="status">
            <p class="todo-empty-title">Nothing left on the board.</p>
            <p class="todo-empty-body">
              Add a task above to start the list again.
            </p>
          </div>
        )}
      </section>
    </main>
  );
}
