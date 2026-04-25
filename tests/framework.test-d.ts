import type { Patch } from "immer";
import { assertType, expectTypeOf, test } from "vitest";

import {
  castProtected,
  listen,
  query,
  setAutoFreeze,
  sigma,
  Sigma,
  SigmaTarget,
  useListener,
  type SigmaRef,
  type SigmaState,
} from "preact-sigma";

// @ts-expect-error shouldSetup is internal-only
import { shouldSetup } from "preact-sigma";

void shouldSetup;

test("sigma classes expose typed public state, computeds, queries, and actions", () => {
  type Todo = {
    id: string;
    title: string;
    completed: boolean;
  };

  type TodoEvents = {
    added: Todo;
    reset: void;
  };

  class TodoList extends SigmaTarget<
    TodoEvents,
    {
      draft: string;
      todos: Todo[];
    }
  > {
    declare draft: string;
    declare todos: Todo[];

    constructor() {
      super({
        draft: "",
        todos: [],
      });
    }

    get completedCount() {
      return this.todos.filter((todo) => todo.completed).length;
    }

    canAdd() {
      return this.draft.length > 0;
    }

    setDraft(draft: string) {
      this.draft = draft;
    }

    clear() {
      this.todos = [];
      this.commit(function () {
        this.emit("reset");
      });
    }
  }

  const todoList = new TodoList();
  assertType<() => boolean>(query(TodoList.prototype.canAdd));

  assertType<string>(todoList.draft);
  assertType<Todo[]>(todoList.todos);
  assertType<number>(todoList.completedCount);
  assertType<boolean>(todoList.canAdd());
  assertType<void>(todoList.setDraft("next"));
  assertType<string>(sigma.getSignal(todoList, "draft").value);
  assertType<string>(sigma.getState(todoList).draft);
  assertType<readonly Todo[]>(sigma.getState(todoList).todos);
  assertType<() => void>(
    sigma.subscribe(todoList, function (nextState, baseState) {
      assertType<string>(nextState.draft);
      assertType<readonly Todo[]>(baseState.todos);
    }),
  );
  assertType<() => void>(
    sigma.subscribe(todoList, "draft", (draft) => {
      assertType<string>(draft);
    }),
  );
  assertType<void>(sigma.replaceState(todoList, sigma.getState(todoList)));
  sigma.replaceState(todoList, {
    draft: "ready",
    todos: [],
  });
  assertType<() => void>(listen(todoList, "reset", () => {}));
  assertType<() => void>(
    listen(todoList, "added", (todo) => {
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
    }>
  >(todoList);

  const createRefCache = (): SigmaRef<{
    count: number;
    nested: {
      label: string;
    };
  }> => ({
    count: 1,
    nested: {
      label: "cache",
    },
  });

  type RefCache = ReturnType<typeof createRefCache>;

  class RefStore extends Sigma<{
    cache: RefCache;
  }> {
    declare cache: RefCache;

    constructor() {
      super({ cache: createRefCache() });
    }
  }

  const refStore = new RefStore();

  refStore.cache.count += 1;
  refStore.cache.nested.label = "next";

  assertType<void>(setAutoFreeze(false));

  const observedCount = new (class ObservedCount extends Sigma<{ count: number }> {
    declare count: number;

    constructor() {
      super({ count: 0 });
    }
  })();

  sigma.subscribe(
    observedCount,
    function (_nextState, _baseState, patches, inversePatches) {
      assertType<readonly Patch[]>(patches);
      assertType<readonly Patch[]>(inversePatches);
    },
    { patches: true },
  );
});

test("SigmaTarget infers typed events for listen and useListener", () => {
  const hub = new (class Hub extends SigmaTarget<{
    opened: {
      id: string;
    };
    closed: void;
  }> {})();

  assertType<void>(
    hub.emit("opened", {
      id: "a",
    }),
  );
  assertType<void>(hub.emit("closed"));

  assertType<() => void>(
    listen(hub, "opened", (payload) => {
      expectTypeOf(payload).toEqualTypeOf<{
        id: string;
      }>();
    }),
  );

  assertType<void>(
    useListener(hub, "opened", (payload) => {
      expectTypeOf(payload).toEqualTypeOf<{
        id: string;
      }>();
    }),
  );

  const protectedHub = castProtected(hub);

  assertType<void>(
    useListener(protectedHub, "opened", (payload) => {
      expectTypeOf(payload).toEqualTypeOf<{
        id: string;
      }>();
    }),
  );

  listen(hub, "missing", (arg) => {
    assertType<never>(arg);
  });
  hub.emit("opened", {
    // @ts-expect-error SigmaTarget payloads come from its event map
    missing: true,
  });
  // @ts-expect-error Void events do not accept payloads
  hub.emit("closed", {});
});

test("setup act is typed on setup contexts", () => {
  class Store extends SigmaTarget<{ changed: { count: number } }, { count: number }> {
    declare count: number;

    constructor() {
      super({ count: 0 });
    }

    onSetup() {
      this.act(function () {
        assertType<number>(this.count);
        assertType<void>(this.commit());
        this.count += 1;
        this.commit();
        this.emit("changed", { count: this.count });
      });

      return [];
    }
  }

  const store = new Store();

  assertType<() => void>(store.setup());
});
