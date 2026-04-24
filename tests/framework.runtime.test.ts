import { computed } from "@preact/signals";
import { enablePatches } from "immer";
import { assert, test } from "vitest";

import { listen, query, setAutoFreeze, sigma, Sigma, SigmaTarget } from "preact-sigma";

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
  reset: void;
};

const todoListInitializers: Array<(this: TodoList) => void> = [];

class TodoList extends SigmaTarget<TodoListEvents, TodoListState> {
  declare draft: string;
  declare todos: Todo[];

  constructor() {
    super({
      draft: "",
      todos: [],
    });
    for (const initializer of todoListInitializers) {
      initializer.call(this);
    }
  }

  get completedCount() {
    return this.todos.filter((todo) => todo.completed).length;
  }

  canAddTodo() {
    return this.draft.trim().length > 0;
  }

  addTodo() {
    const todo = {
      id: String(this.todos.length + 1),
      title: this.draft,
      completed: false,
    };
    this.todos.push(todo);
    this.draft = "";
    this.commit(function () {
      this.emit("added", todo);
    });
  }

  reset() {
    this.todos = [];
    this.commit(function () {
      this.emit("reset");
    });
  }

  setDraft(draft: string) {
    this.draft = draft;
  }

  toggleFirstTodo() {
    this.todos[0].completed = !this.todos[0].completed;
  }
}

query(TodoList.prototype.canAddTodo, {
  name: "canAddTodo",
  addInitializer(initializer: (this: TodoList) => void) {
    todoListInitializers.push(initializer);
  },
} as ClassMethodDecoratorContext<TodoList, TodoList["canAddTodo"]>);

const counterInitializers: Array<(this: Counter) => void> = [];

class Counter extends Sigma<{ count: number }> {
  declare count: number;

  constructor(count = 0) {
    super({ count });
    for (const initializer of counterInitializers) {
      initializer.call(this);
    }
  }

  get doubled() {
    return this.count * 2;
  }

  isEven() {
    return this.count % 2 === 0;
  }

  increment() {
    this.count += 1;
  }

  incrementTwice() {
    this.increment();
    this.increment();
  }
}

query(Counter.prototype.isEven, {
  name: "isEven",
  addInitializer(initializer: (this: Counter) => void) {
    counterInitializers.push(initializer);
  },
} as ClassMethodDecoratorContext<Counter, Counter["isEven"]>);

test("sigma classes expose readonly state, computeds, query decorators, and actions", () => {
  const todoList = new TodoList();
  const observedCounts = computed(() => todoList.completedCount);
  let addedTitle = "";
  const stop = listen(todoList, "added", (todo) => {
    addedTitle = todo.title;
  });

  assert.equal(todoList.draft, "");
  assert.equal(todoList.canAddTodo(), false);

  todoList.setDraft("Ship v6");

  assert.equal(todoList.canAddTodo(), true);

  todoList.addTodo();

  assert.equal(addedTitle, "Ship v6");
  assert.equal(todoList.draft, "");
  assert.equal(todoList.todos[0].title, "Ship v6");
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

test("sigma.getState returns committed public state", () => {
  const counter = new Counter(1);

  assert.deepEqual(sigma.getState(counter), { count: 1 });
  assert.equal(sigma.getSignal(counter, "count").value, 1);
  assert.equal(counter.doubled, 2);

  counter.increment();

  assert.deepEqual(sigma.getState(counter), { count: 2 });
  assert.equal(counter.doubled, 4);
});

test("sigma.subscribe observes full-state publishes and individual state properties", () => {
  const observedStates: Array<{ base: number; next: number }> = [];
  const observedCounts: number[] = [];
  const counter = new Counter();

  const stopState = sigma.subscribe(counter, (nextState, baseState) => {
    observedStates.push({
      base: baseState.count,
      next: nextState.count,
    });
  });
  const stopCount = sigma.subscribe(counter, "count", (count) => {
    observedCounts.push(count);
  });

  counter.increment();
  stopState();
  stopCount();
  counter.increment();

  assert.deepEqual(observedStates, [{ base: 0, next: 1 }]);
  assert.deepEqual(observedCounts, [0, 1]);
});

test("listen unwraps sigma event payloads and supports void events", () => {
  const todoList = new TodoList();
  const observed: string[] = [];

  const stopAdded = listen(todoList, "added", (todo) => {
    observed.push(`added:${todo.title}`);
  });
  const stopReset = listen(todoList, "reset", () => {
    observed.push("reset");
  });

  todoList.setDraft("Ship v6");
  todoList.addTodo();
  todoList.reset();
  stopAdded();
  stopReset();
  todoList.setDraft("Ignored");
  todoList.addTodo();
  todoList.reset();

  assert.deepEqual(observed, ["added:Ship v6", "reset"]);
});

test("setup returns a cleanup that owns resources in reverse order", () => {
  const observedEvents: string[] = [];
  const target = new EventTarget();
  const cleanupOrder: string[] = [];

  class Child extends Sigma<{ ready: boolean }> {
    declare ready: boolean;

    constructor() {
      super({ ready: true });
    }

    onSetup() {
      return [
        () => {
          cleanupOrder.push("child");
        },
      ];
    }
  }

  class Parent extends Sigma<{ ready: boolean }> {
    declare ready: boolean;

    constructor() {
      super({ ready: false });
    }

    onSetup() {
      const child = new Child();
      const stop = listen(target, "sigma-v6-ping", () => {
        observedEvents.push("ping");
      });

      return [
        child.setup(),
        stop,
        () => {
          cleanupOrder.push("parent");
        },
      ];
    }
  }

  const parent = new Parent();
  const cleanup = parent.setup();

  target.dispatchEvent(new Event("sigma-v6-ping"));
  cleanup();
  target.dispatchEvent(new Event("sigma-v6-ping"));

  assert.deepEqual(observedEvents, ["ping"]);
  assert.deepEqual(cleanupOrder, ["parent", "child"]);
});

test("setup act runs an anonymous action with normal action semantics", () => {
  const observedCounts: number[] = [];

  class Store extends SigmaTarget<{ changed: { count: number } }, { count: number }> {
    declare count: number;

    constructor() {
      super({ count: 0 });
    }

    onSetup(step: number) {
      this.act(function () {
        this.count += step;
        this.commit();
        this.emit("changed", { count: this.count });
      });

      return [];
    }
  }

  const store = new Store();
  const stop = listen(store, "changed", ({ count }) => {
    observedCounts.push(count);
  });

  store.setup(2);

  assert.equal(store.count, 2);
  assert.deepEqual(observedCounts, [2]);
  assert.throws(() => {
    store.act(function () {});
  }, /outside an onSetup/);

  stop();
});

test("setup act callbacks must stay synchronous", () => {
  class Store extends Sigma<{ count: number }> {
    declare count: number;

    constructor() {
      super({ count: 0 });
    }

    onSetup() {
      this.act(async function () {
        this.count += 1;
      });
      return [];
    }
  }

  const store = new Store();

  assert.throws(() => {
    store.setup();
  }, /act\(\) callbacks must be synchronous/);
  assert.equal(store.count, 0);
});

test("actions reuse one draft and can call queries, computeds, and other actions", () => {
  class ReentrantCounter extends Counter {
    incrementTwiceWithChecks() {
      this.increment();
      assert.equal(this.count, 1);
      assert.equal(this.doubled, 2);
      assert.equal(this.isEven(), false);
      this.increment();
    }
  }

  const counter = new ReentrantCounter();

  counter.incrementTwiceWithChecks();

  assert.equal(counter.count, 2);
  assert.equal(counter.doubled, 4);
  assert.equal(counter.isEven(), true);
});

test("commit publishes an explicit boundary inside sync actions", () => {
  const observed: number[] = [];

  class BoundaryCounter extends Counter {
    incrementTwice() {
      this.count += 1;
      this.commit();
      this.count += 1;
    }
  }

  const counter = new BoundaryCounter();
  const stop = sigma.subscribe(counter, (nextState) => {
    observed.push(nextState.count);
  });

  counter.incrementTwice();

  assert.equal(counter.count, 2);
  assert.deepEqual(observed, [1, 2]);
  stop();
});

test("actions that return promises must commit before returning", () => {
  class PromiseCounter extends Counter {
    incrementLater() {
      this.count += 1;
      return Promise.resolve();
    }
  }

  const counter = new PromiseCounter();

  assert.throws(() => {
    counter.incrementLater();
  }, /forgot to commit\(\) its draft before returning a promise/);
  assert.equal(counter.count, 1);
});

test("async actions can commit after await", async () => {
  const observed: number[] = [];

  class AsyncCounter extends Counter {
    async incrementLater() {
      await Promise.resolve();
      this.count += 1;
      this.commit();
    }
  }

  const counter = new AsyncCounter();
  const stop = sigma.subscribe(counter, (nextState) => {
    observed.push(nextState.count);
  });
  const pending = counter.incrementLater();

  assert.equal(counter.count, 0);
  await pending;

  assert.equal(counter.count, 1);
  assert.deepEqual(observed, [1]);
  stop();
});

test("sigma.replaceState restores committed state and notifies subscribers", () => {
  enablePatches();

  const observed: Array<{
    count: number;
    inversePatches: unknown[] | undefined;
    patches: unknown[] | undefined;
  }> = [];

  const counter = new Counter();
  const stop = sigma.subscribe(
    counter,
    (nextState, _baseState, patches, inversePatches) => {
      observed.push({
        count: nextState.count,
        inversePatches: inversePatches && [...inversePatches],
        patches: patches && [...patches],
      });
    },
    { patches: true },
  );
  const initial = sigma.getState(counter);

  counter.increment();
  sigma.replaceState(counter, initial);

  assert.equal(counter.count, 0);
  assert.lengthOf(observed, 2);
  assert.sameDeepMembers(observed[1].inversePatches ?? [], [
    { op: "replace", path: ["count"], value: 1 },
  ]);
  assert.sameDeepMembers(observed[1].patches ?? [], [{ op: "replace", path: ["count"], value: 0 }]);
  stop();
});

test("sigma.replaceState requires a plain object snapshot", () => {
  const counter = new Counter();

  assert.throws(() => {
    sigma.replaceState(counter, [] as unknown as { count: number });
  }, /requires a plain object snapshot/);
});

test("sigma.replaceState is a no-op for the current committed snapshot", () => {
  const observed: number[] = [];
  const counter = new Counter();
  const stop = sigma.subscribe(counter, (nextState) => {
    observed.push(nextState.count);
  });
  const initial = sigma.getState(counter);

  sigma.replaceState(counter, initial);
  assert.deepEqual(observed, []);

  counter.increment();
  const changed = sigma.getState(counter);
  sigma.replaceState(counter, changed);

  assert.equal(counter.count, 1);
  assert.deepEqual(observed, [1]);
  stop();
});

test("sigma.replaceState throws while an async action has unpublished changes", async () => {
  let release!: () => void;
  const blocked = new Promise<void>((resolve) => {
    release = resolve;
  });

  class AsyncCounter extends Counter {
    async stageIncrement() {
      await Promise.resolve();
      this.count += 1;
      await blocked;
      this.commit();
    }
  }

  const counter = new AsyncCounter();
  const pending = counter.stageIncrement();

  await Promise.resolve();
  await Promise.resolve();

  assert.throws(() => {
    sigma.replaceState(counter, sigma.getState(counter));
  }, /replaceState\(\) cannot run while an action has unpublished changes/);

  release();
  await pending;
  assert.equal(counter.count, 1);
});

test("sigma.subscribe can include immer patches when enabled by the app", () => {
  enablePatches();

  const observed: Array<{
    inversePatches: unknown[];
    patches: unknown[];
  }> = [];

  class Search extends Sigma<{ draft: string; tags: string[] }> {
    declare draft: string;
    declare tags: string[];

    constructor() {
      super({
        draft: "",
        tags: [],
      });
    }

    update() {
      this.draft = "hello";
      this.tags.push("sigma");
    }
  }

  const search = new Search();
  const stop = sigma.subscribe(
    search,
    (_nextState, _baseState, patches, inversePatches) => {
      observed.push({
        inversePatches: [...inversePatches],
        patches: [...patches],
      });
    },
    { patches: true },
  );

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
  stop();
});

test("nested sigma states can be stored in state without being mutated through parent actions", () => {
  const child = new Counter();

  class Parent extends Sigma<{
    child: Counter;
    label: string;
  }> {
    declare child: Counter;
    declare label: string;

    constructor() {
      super({
        child,
        label: "parent",
      });
    }

    rename(label: string) {
      this.label = label;
    }
  }

  const parent = new Parent();

  parent.rename("renamed");
  parent.child.increment();

  assert.equal(parent.label, "renamed");
  assert.equal(parent.child.count, 1);
});

test("setAutoFreeze controls deep runtime freezing of published state", () => {
  class Store extends Sigma<{
    config: {
      nested: {
        count: number;
      };
      tags: string[];
    };
  }> {
    declare config: {
      nested: {
        count: number;
      };
      tags: string[];
    };

    constructor() {
      super({
        config: {
          nested: { count: 1 },
          tags: ["a"],
        },
      });
    }

    replaceConfig() {
      this.config = {
        nested: { count: 2 },
        tags: ["a", "b"],
      };
    }
  }

  try {
    setAutoFreeze(true);
    const frozenStore = new Store();
    frozenStore.replaceConfig();

    assert.equal(Object.isFrozen(frozenStore.config), true);
    assert.equal(Object.isFrozen(frozenStore.config.nested), true);
    assert.equal(Object.isFrozen(frozenStore.config.tags), true);

    setAutoFreeze(false);
    const unfrozenStore = new Store();
    unfrozenStore.replaceConfig();

    assert.equal(Object.isFrozen(unfrozenStore.config), false);
    assert.equal(Object.isFrozen(unfrozenStore.config.nested), false);
    assert.equal(Object.isFrozen(unfrozenStore.config.tags), false);
  } finally {
    setAutoFreeze(true);
  }
});
