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
  useSigmaSync,
  type SigmaRef,
  type SigmaState,
  type Immutable,
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

  type TodoState = {
    draft: string;
    todos: Todo[];
  };

  class TodoList extends SigmaTarget<TodoEvents, TodoState> {
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
  assertType<string>(sigma.captureState(todoList).draft);
  assertType<readonly Todo[]>(sigma.captureState(todoList).todos);
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
  assertType<void>(sigma.replaceState(todoList, sigma.captureState(todoList)));
  const immutableTodoState: Immutable<TodoState> = {
    draft: "ready",
    todos: [],
  };

  class ImmutableTodoList extends Sigma<TodoState> {
    declare draft: string;
    declare todos: Todo[];

    constructor(initialState: Immutable<TodoState>) {
      super(initialState);
    }
  }

  assertType<string>(new ImmutableTodoList(immutableTodoState).draft);
  assertType<SigmaTarget<TodoEvents, TodoState>>(
    new SigmaTarget<TodoEvents, TodoState>(immutableTodoState),
  );
  assertType<void>(sigma.replaceState<TodoState>(todoList, immutableTodoState));
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

  const protectedTodoList = castProtected(todoList);
  assertType<string>(protectedTodoList.draft);
  assertType<readonly Todo[]>(protectedTodoList.todos);
  assertType<string>(sigma.captureState(protectedTodoList).draft);
  assertType<readonly Todo[]>(sigma.captureState(protectedTodoList).todos);
  assertType<() => void>(
    sigma.subscribe(protectedTodoList, function (nextState, baseState) {
      assertType<string>(nextState.draft);
      assertType<readonly Todo[]>(baseState.todos);
    }),
  );
  assertType<() => void>(
    sigma.subscribe(protectedTodoList, "draft", (draft) => {
      assertType<string>(draft);
    }),
  );
  assertType<void>(protectedTodoList.clear());
  // @ts-expect-error Protected state is readonly
  protectedTodoList.draft = "draft";
  // @ts-expect-error Protected views do not expose action-only commit boundaries
  protectedTodoList.commit();
  // @ts-expect-error Protected views do not expose emit
  protectedTodoList.emit("reset");

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
    castProtected(observedCount),
    function (_nextState, _baseState, patches, inversePatches) {
      assertType<readonly Patch[]>(patches);
      assertType<readonly Patch[]>(inversePatches);
    },
    { patches: true },
  );
});

test("SigmaTarget infers typed events for listen and useListener", () => {
  const directHub = new SigmaTarget<{
    opened: {
      id: string;
    };
    closed: void;
  }>();

  assertType<void>(
    directHub.emit("opened", {
      id: "a",
    }),
  );
  assertType<void>(directHub.emit("closed"));

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

test("useSigmaSync accepts protected sigma instances and readonly plain object input", () => {
  class Search extends Sigma<{ query: string }> {
    declare query: string;

    constructor() {
      super({ query: "" });
    }

    syncQueryData(data: readonly string[]) {
      this.query = data.join(",");
    }
  }

  const search = castProtected(new Search());

  function Probe(data: readonly string[]) {
    useSigmaSync(search, { data }, ({ data }) => {
      assertType<readonly string[]>(data);
      search.syncQueryData(data);
      // @ts-expect-error sync input is readonly
      data.push("next");
    });
  }

  void Probe;
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
