import { computed } from "@preact/signals";
import { enablePatches } from "immer";
import { assert, test } from "vitest";

import { listen, query, ref, SigmaType, type SigmaState } from "preact-sigma";

test("sigma states expose readonly state, computeds, queries, and actions", () => {
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
      addTodo() {
        const todo = {
          id: String(this.todos.length + 1),
          title: this.draft,
          completed: false,
        };
        this.todos.push(todo);
        this.draft = "";
        this.commit();
        this.emit("added", todo);
      },
      setDraft(draft: string) {
        this.draft = draft;
      },
      toggleFirstTodo() {
        this.todos[0].completed = !this.todos[0].completed;
      },
    });

  const todoList = new TodoList();
  const observedCounts = computed(() => todoList.completedCount);
  let addedTitle = "";
  const stop = todoList.on("added", (todo) => {
    addedTitle = todo.title;
  });

  assert.equal(todoList.draft, "");
  assert.equal(todoList.canAddTodo(), false);

  todoList.setDraft("Ship v2");

  assert.equal(todoList.canAddTodo(), true);

  todoList.addTodo();

  assert.equal(addedTitle, "Ship v2");
  assert.equal(todoList.draft, "");
  assert.equal(todoList.todos[0].title, "Ship v2");
  assert.equal(observedCounts.value, 0);

  todoList.toggleFirstTodo();

  assert.equal(todoList.completedCount, 1);
  assert.equal(observedCounts.value, 1);
  assert.throws(() => {
    (todoList.todos as Todo[]).push({
      id: "2",
      title: "mutate",
      completed: false,
    });
  });

  stop();
});

test("setup returns a single cleanup that owns nested resources", () => {
  const observedEvents: string[] = [];
  const abortController = new AbortController();
  const target = new EventTarget();
  let functionCleanupCount = 0;
  let disposableCleanupCount = 0;
  let childCleanupCount = 0;

  const ChildState = new SigmaType<{ ready: boolean }>()
    .defaultState({
      ready: true,
    })
    .setup(function () {
      return [
        () => {
          childCleanupCount += 1;
        },
      ];
    });

  const ParentState = new SigmaType<{ ready: boolean }>()
    .defaultState({
      ready: false,
    })
    .setup(function () {
      const child = new ChildState();
      return [child.setup()];
    })
    .setup(function () {
      const stop = listen(target, "sigma-v2-ping", () => {
        observedEvents.push("ping");
      });

      return [
        stop,
        abortController,
        () => {
          functionCleanupCount += 1;
        },
        {
          [Symbol.dispose]() {
            disposableCleanupCount += 1;
          },
        },
      ];
    });

  const parent = new ParentState();
  const cleanup = parent.setup();

  target.dispatchEvent(new Event("sigma-v2-ping"));
  cleanup();
  target.dispatchEvent(new Event("sigma-v2-ping"));

  assert.deepEqual(observedEvents, ["ping"]);
  assert.equal(abortController.signal.aborted, true);
  assert.equal(functionCleanupCount, 1);
  assert.equal(disposableCleanupCount, 1);
  assert.equal(childCleanupCount, 1);
});

test("setup handlers must return arrays", () => {
  const Store = new SigmaType<{ count: number }>()
    .defaultState({
      count: 0,
    })
    .setup(function () {
      return (() => {}) as unknown as [];
    });

  const store = new Store();

  assert.throws(() => {
    store.setup();
  }, /must return an array/);
});

test("actions reuse one draft and can call queries, computeds, and other actions", () => {
  const Counter = new SigmaType<{ count: number }>()
    .defaultState({
      count: 0,
    })
    .computed({
      doubled() {
        return this.count * 2;
      },
    })
    .queries({
      isEven() {
        return this.count % 2 === 0;
      },
    })
    .actions({
      increment() {
        this.count += 1;
      },
      incrementTwice() {
        this.increment();
        assert.equal(this.count, 1);
        assert.equal(this.doubled, 2);
        assert.equal(this.isEven(), false);
        this.increment();
      },
    });

  const counter = new Counter();

  counter.incrementTwice();

  assert.equal(counter.count, 2);
  assert.equal(counter.doubled, 4);
  assert.equal(counter.isEven(), true);
});

test("commit publishes an explicit boundary inside sync actions", () => {
  const observed: number[] = [];

  const Counter = new SigmaType<{ count: number }>()
    .defaultState({
      count: 0,
    })
    .observe((change) => {
      observed.push(change.newState.count);
    })
    .actions({
      incrementTwice() {
        this.count += 1;
        this.commit();
        this.count += 1;
      },
    });

  const counter = new Counter();

  counter.incrementTwice();

  assert.equal(counter.count, 2);
  assert.deepEqual(observed, [1, 2]);
});

test("non-async actions that return promises throw and discard draft changes", () => {
  const Counter = new SigmaType<{ count: number }>()
    .defaultState({
      count: 0,
    })
    .actions({
      incrementLater() {
        this.count += 1;
        return Promise.resolve();
      },
    });

  const counter = new Counter();

  assert.throws(() => {
    counter.incrementLater();
  }, /must use native async-await syntax to return a promise/);
  assert.equal(counter.count, 0);
});

test("async actions auto-commit sync work and reject when they settle with unpublished changes", async () => {
  const Counter = new SigmaType<{ count: number }>()
    .defaultState({
      count: 0,
    })
    .actions({
      async incrementLater() {
        this.count += 1;
        await Promise.resolve();
        this.count += 1;
      },
    });

  const counter = new Counter();

  const pending = counter.incrementLater();

  assert.equal(counter.count, 1);
  await pending.then(
    () => {
      assert.fail("Expected incrementLater() to reject");
    },
    (error) => {
      assert.match(String(error), /finished with unpublished changes/);
    },
  );
  assert.equal(counter.count, 1);
});

test("async actions can commit after await", async () => {
  const observed: number[] = [];

  const Counter = new SigmaType<{ count: number }>()
    .defaultState({
      count: 0,
    })
    .observe((change) => {
      observed.push(change.newState.count);
    })
    .actions({
      async incrementLater() {
        this.count += 1;
        await Promise.resolve();
        this.count += 1;
        this.commit();
      },
    });

  const counter = new Counter();
  const pending = counter.incrementLater();

  assert.equal(counter.count, 1);
  await pending;

  assert.equal(counter.count, 2);
  assert.deepEqual(observed, [1, 2]);
});

test("async actions throw when they cross a boundary with unpublished changes", async () => {
  const Counter = new SigmaType<{ count: number }, { ignored: void }>()
    .defaultState({
      count: 0,
    })
    .actions({
      increment() {
        this.count += 1;
      },
      async incrementLater() {
        await Promise.resolve();
        this.count += 1;
        this.commit();
      },
      async emitAfterWrite() {
        await Promise.resolve();
        this.count += 1;
        this.emit("ignored");
      },
      async callAsyncActionAfterWrite() {
        await Promise.resolve();
        this.count += 1;
        await this.incrementLater();
      },
      async callSyncActionAfterWrite() {
        await Promise.resolve();
        this.count += 1;
        this.increment();
        this.commit();
      },
      emitAfterWriteSync() {
        this.count += 1;
        this.emit("ignored");
      },
    });

  const counter = new Counter();

  await counter.emitAfterWrite().then(
    () => {
      assert.fail("Expected emitAfterWrite() to reject");
    },
    (error) => {
      assert.match(String(error), /before emit/);
    },
  );
  assert.equal(counter.count, 0);

  await counter.callAsyncActionAfterWrite().then(
    () => {
      assert.fail("Expected callAsyncActionAfterWrite() to reject");
    },
    (error) => {
      assert.match(String(error), /before calling another action/);
    },
  );
  assert.equal(counter.count, 0);

  await counter.callSyncActionAfterWrite();
  assert.equal(counter.count, 2);

  assert.throws(() => {
    counter.emitAfterWriteSync();
  }, /before emit/);
  assert.equal(counter.count, 2);
});

test("foreign actions warn and discard unpublished changes", async () => {
  const warnings: unknown[][] = [];
  const originalWarn = console.warn;
  let release!: () => void;
  const blocked = new Promise<void>((resolve) => {
    release = resolve;
  });

  const Counter = new SigmaType<{ count: number }>()
    .defaultState({
      count: 0,
    })
    .actions({
      increment() {
        this.count += 1;
      },
      async stageIncrement() {
        await Promise.resolve();
        this.count += 1;
        await blocked;
      },
    });

  const counter = new Counter();
  console.warn = (...args: unknown[]) => {
    warnings.push(args);
  };

  try {
    const pending = counter.stageIncrement();
    await Promise.resolve();
    await Promise.resolve();

    counter.increment();
    release();
    await pending;

    assert.equal(counter.count, 1);
    assert.lengthOf(warnings, 1);
    assert.match(String(warnings[0][0]), /Discarded unpublished action changes/);
  } finally {
    console.warn = originalWarn;
  }
});

test("same-instance async actions can start from another action when no draft is open", async () => {
  const Counter = new SigmaType<{ count: number }>()
    .defaultState({
      count: 0,
    })
    .actions({
      increment() {
        this.count += 1;
      },
      async incrementLater() {
        await Promise.resolve();
        this.increment();
        this.commit();
      },
      async incrementTwice() {
        const first = this.incrementLater();
        const second = this.incrementLater();
        await first;
        await second;
      },
    });

  const counter = new Counter();

  await counter.incrementTwice();

  assert.equal(counter.count, 2);
});

test("observe runs after committed base-state changes", () => {
  const observed: Array<{
    count: number;
    doubled: number;
    hasCount: boolean;
    previousCount: number;
    stateCount: number;
  }> = [];

  const Counter = new SigmaType<{ count: number }>()
    .defaultState({
      count: 0,
    })
    .computed({
      doubled() {
        return this.count * 2;
      },
    })
    .queries({
      hasCount() {
        return this.count > 0;
      },
    })
    .observe(function (change) {
      observed.push({
        count: this.count,
        doubled: this.doubled,
        hasCount: this.hasCount(),
        previousCount: change.oldState.count,
        stateCount: change.newState.count,
      });
    })
    .actions({
      increment() {
        this.count += 1;
      },
      incrementTwice() {
        this.increment();
        this.increment();
      },
      noop() {},
    });

  const counter = new Counter();

  counter.noop();
  assert.deepEqual(observed, []);

  counter.incrementTwice();

  assert.deepEqual(observed, [
    {
      count: 2,
      doubled: 4,
      hasCount: true,
      previousCount: 0,
      stateCount: 2,
    },
  ]);
});

test("observe can include immer patches when enabled by the app", () => {
  enablePatches();

  const observed: Array<{
    inversePatches: unknown[];
    patches: unknown[];
  }> = [];

  const Search = new SigmaType<{
    draft: string;
    tags: string[];
  }>()
    .defaultState({
      draft: "",
      tags: [],
    })
    .observe(
      (change) => {
        observed.push({
          inversePatches: [...change.inversePatches],
          patches: [...change.patches],
        });
      },
      { patches: true },
    )
    .actions({
      update() {
        this.draft = "hello";
        this.tags.push("sigma");
      },
    });

  const search = new Search();

  search.update();

  assert.lengthOf(observed, 1);
  assert.sameDeepMembers(observed[0].inversePatches, [
    { op: "replace", path: ["draft"], value: "" },
    { op: "remove", path: ["tags", 0] },
  ]);
  assert.sameDeepMembers(observed[0].patches, [
    { op: "replace", path: ["draft"], value: "hello" },
    { op: "add", path: ["tags", 0], value: "sigma" },
  ]);
});

test("external query helpers isolate caller tracking", () => {
  const hasText = query((value: string) => value.trim().length > 0);
  const Search = new SigmaType<{ draft: string }>()
    .defaultState({
      draft: "",
    })
    .actions({
      setDraft(value: string) {
        this.draft = value;
      },
    });

  const search = new Search();
  const result = computed(() => hasText(search.draft));

  assert.equal(result.value, false);
  search.setDraft("hello");
  assert.equal(result.value, true);
});

test("initial state shallowly overrides defaults", () => {
  const Search = new SigmaType<{
    page: number;
    query: string;
  }>().defaultState({
    page: 1,
    query: "",
  });

  const search = new Search({
    query: "typed",
  });

  assert.equal(search.page, 1);
  assert.equal(search.query, "typed");
});

test("function-valued defaults run once per instance when needed", () => {
  let idDefaultCalls = 0;
  let tagsDefaultCalls = 0;

  const Search = new SigmaType<{
    id: number;
    tags: string[];
  }>().defaultState({
    id() {
      idDefaultCalls += 1;
      return idDefaultCalls;
    },
    tags: () => {
      tagsDefaultCalls += 1;
      return [];
    },
  });

  const first = new Search();
  const second = new Search();
  const overridden = new Search({
    id: 99,
  });

  assert.equal(first.id, 1);
  assert.equal(second.id, 2);
  assert.equal(overridden.id, 99);
  assert.equal(idDefaultCalls, 2);
  assert.equal(tagsDefaultCalls, 3);
  assert.notStrictEqual(first.tags, second.tags);
  assert.notStrictEqual(second.tags, overridden.tags);
});

test("nested sigma states can be stored in state without being mutated through actions", () => {
  const Child = new SigmaType<{ count: number }>()
    .defaultState({
      count: 0,
    })
    .actions({
      increment() {
        this.count += 1;
      },
    });

  const child = new Child();

  const Parent = new SigmaType<{
    child: SigmaState<{
      state: { count: number };
      actions: { increment(): void };
    }>;
    label: string;
  }>()
    .defaultState({
      child,
      label: "parent",
    })
    .actions({
      rename(label: string) {
        this.label = label;
      },
    });

  const parent = new Parent();

  parent.rename("renamed");
  parent.child.increment();

  assert.equal(parent.label, "renamed");
  assert.equal(parent.child.count, 1);
});

test("ref prevents freezing of top-level plain objects, arrays, maps, and sets", () => {
  const objectRef = ref({ count: 1 });
  const arrayRef = ref(["a"]);
  const mapRef = ref(new Map([["a", 1]]));
  const setRef = ref(new Set(["a"]));

  const Store = new SigmaType<{
    objectRef: typeof objectRef;
    arrayRef: typeof arrayRef;
    mapRef: typeof mapRef;
    setRef: typeof setRef;
  }>().defaultState({
    objectRef,
    arrayRef,
    mapRef,
    setRef,
  });

  const store = new Store();

  assert.equal(Object.isFrozen(store.objectRef), false);
  assert.equal(Object.isFrozen(store.arrayRef), false);

  store.objectRef.count += 1;
  store.arrayRef.push("b");
  store.mapRef.set("b", 2);
  store.setRef.add("b");

  assert.equal(store.objectRef.count, 2);
  assert.deepEqual(store.arrayRef, ["a", "b"]);
  assert.equal(store.mapRef.get("b"), 2);
  assert.equal(store.setRef.has("b"), true);
});
