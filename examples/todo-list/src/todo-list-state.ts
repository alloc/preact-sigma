import { useState } from "preact/hooks";
import { computed, type StateHandle, useManagedState } from "preact-sigma";

type Todo = {
  id: string;
  title: string;
  done: boolean;
};

export type Filter = "all" | "active" | "done";

type TodoListState = {
  draft: string;
  filter: Filter;
  todos: Todo[];
};

export type TodoListDerivationInput = Pick<
  TodoListState,
  "draft" | "filter" | "todos"
>;

export type TodoEvents = {
  todoAdded: [{ title: string }];
  todoRemoved: [{ title: string }];
  clearedCompleted: [{ count: number }];
};

type TodoListHandle = StateHandle<TodoListState, TodoEvents>;
export const STORAGE_KEY = "preact-sigma.todo-list";

export const FILTER_LABELS: Record<Filter, string> = {
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

export function getVisibleTodos(state: TodoListDerivationInput) {
  if (state.filter === "active") {
    return state.todos.filter((todo) => !todo.done);
  }

  if (state.filter === "done") {
    return state.todos.filter((todo) => todo.done);
  }

  return state.todos;
}

export function getRemainingCount(state: Pick<TodoListDerivationInput, "todos">) {
  return state.todos.filter((todo) => !todo.done).length;
}

export function getCompletedCount(state: Pick<TodoListDerivationInput, "todos">) {
  return state.todos.filter((todo) => todo.done).length;
}

export function canSubmitDraft(state: Pick<TodoListDerivationInput, "draft">) {
  return state.draft.trim().length > 0;
}

export function hasCompletedTodos(
  state: Pick<TodoListDerivationInput, "todos">,
) {
  return state.todos.some((todo) => todo.done);
}

export function useTodoList() {
  const [initialState] = useState(createInitialState);

  return useManagedState((todoList: TodoListHandle) => {
    // Cache the filtered collection because it does the most repeated work.
    const visibleTodos = computed(() => getVisibleTodos(todoList.get()));

    return {
      get draft() {
        return todoList.get().draft;
      },
      get filter() {
        return todoList.get().filter;
      },
      get todos() {
        return todoList.get().todos;
      },
      visibleTodos,
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
}
