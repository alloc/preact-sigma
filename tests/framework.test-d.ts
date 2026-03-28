import type { Patch } from "immer";
import { assertType, expectTypeOf, test } from "vitest";

import { action, immerable, query, SigmaType, type SigmaState } from "preact-sigma";

// @ts-expect-error shouldSetup is internal-only
import { shouldSetup } from "preact-sigma";

void shouldSetup;

test("sigma infers public state from the two-step declaration", () => {
  type Todo = {
    id: string;
    title: string;
    completed: boolean;
  };

  type TodoEvents = {
    added: Todo;
    reset: void;
  };

  type TodoListComputeds = {
    completedCount(): number;
  };

  type TodoListQueries = {
    canAdd(): boolean;
  };

  type TodoListActions = {
    clear(): void;
    setDraft(draft: string): void;
  };

  const todoListComputeds: TodoListComputeds = {
    completedCount() {
      return 0;
    },
  };

  const todoListQueries: TodoListQueries = {
    canAdd() {
      return true;
    },
  };

  const todoListActions: TodoListActions = {
    setDraft(draft: string) {
      void draft;
    },
    clear() {},
  };

  const TodoList = new SigmaType<
    {
      draft: string;
      todos: Todo[];
    },
    TodoEvents
  >()
    .defaultState({
      draft: "",
      todos: [],
    })
    .computed(todoListComputeds)
    .queries(todoListQueries)
    .observe(function (change) {
      assertType<string>(this.draft);
      assertType<number>(this.completedCount);
      assertType<boolean>(this.canAdd());
      assertType<string>(change.oldState.draft);
      assertType<readonly Todo[]>(change.newState.todos);
      // @ts-expect-error patches are only available when requested
      void change.patches;
    })
    .setup(function (prefix: string) {
      void prefix;
      return [];
    })
    .actions(todoListActions);

  const todoList = new TodoList();

  assertType<string>(todoList.draft);
  assertType<readonly Todo[]>(todoList.todos);
  assertType<number>(todoList.completedCount);
  assertType<boolean>(todoList.canAdd());
  assertType<void>(todoList.setDraft("next"));
  assertType<() => void>(todoList.setup("id"));
  assertType<() => void>(todoList.on("reset", () => {}));
  assertType<() => void>(
    todoList.on("added", (todo) => {
      expectTypeOf(todo).toEqualTypeOf<Todo>();
    }),
  );
  assertType<
    SigmaState<{
      state: {
        draft: string;
        todos: Todo[];
      };
      events: TodoEvents;
      computeds: TodoListComputeds;
      queries: TodoListQueries;
      actions: TodoListActions;
      setupArgs: [prefix: string];
    }>
  >(todoList);

  const explicitAction = action((count: number) => count + 1);
  expectTypeOf(explicitAction).toEqualTypeOf<(count: number) => number>();

  const hasText = query((value: string) => value.length > 0);
  expectTypeOf(hasText).toEqualTypeOf<(value: string) => boolean>();

  class MutableCache {
    count = 1;
  }

  class DraftableCache {
    [immerable] = true as const;
    count = 1;
  }

  assertType<MutableCache>(new MutableCache());
  assertType<DraftableCache>(new DraftableCache());

  const Search = new SigmaType<{ count: number }>().defaultState({
    count: 0,
  });

  assertType<number>(new Search().count);

  const Generated = new SigmaType<{
    id: number;
    tags: string[];
  }>().defaultState({
    id: () => 1,
    tags: () => ["a"],
  });

  const generated = new Generated();

  assertType<number>(generated.id);
  assertType<readonly string[]>(generated.tags);

  new SigmaType<{ count: number }>().defaultState({
    // @ts-expect-error initializer result must match the state property type
    count: () => "wrong",
  });

  new SigmaType<{ count: number }>()
    // @ts-expect-error setup handlers must return arrays of cleanup resources
    .setup(function () {
      return () => {};
    });

  new SigmaType<{ count: number }>()
    .defaultState({
      count: 0,
    })
    .observe(
      function (change) {
        assertType<number>(this.count);
        assertType<readonly Patch[]>(change.patches);
        assertType<readonly Patch[]>(change.inversePatches);
      },
      { patches: true },
    );
});

test("inline builder methods infer this for state reads", () => {
  new SigmaType<{ count: number }>()
    .defaultState({
      count: 0,
    })
    .computed({
      doubled() {
        assertType<number>(this.count);
        return this.count * 2;
      },
    })
    .queries({
      hasCount() {
        assertType<number>(this.count);
        return this.count > 0;
      },
    })
    .actions({
      increment() {
        assertType<number>(this.count);
        assertType<void>(this.commit());
        this.count += 1;
      },
    });
});
