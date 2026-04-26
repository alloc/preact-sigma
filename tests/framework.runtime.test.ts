import { computed } from "@preact/signals";
import { enablePatches } from "immer";
import { assert, test } from "vitest";

import {
  listen,
  mergeDefaults,
  query,
  setAutoFreeze,
  sigma,
  Sigma,
  SigmaTarget,
} from "preact-sigma";

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

class TodoList extends SigmaTarget<TodoListEvents, TodoListState> {
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

TodoList.prototype.canAddTodo = query(TodoList.prototype.canAddTodo);

class Counter extends Sigma<{ count: number }> {
  declare count: number;

  constructor(count = 0) {
    super({ count });
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

Counter.prototype.isEven = query(Counter.prototype.isEven);

test("mergeDefaults keeps defaults for omitted and undefined initial values", () => {
  const defaults = {
    draft: "",
    page: 1,
  };

  assert.deepEqual(mergeDefaults(undefined, defaults), defaults);
  assert.deepEqual(mergeDefaults({ draft: "sigma", page: undefined }, defaults), {
    draft: "sigma",
    page: 1,
  });
});

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

test("subclasses initialize inherited actions and computeds before base instances exist", () => {
  type BaseCounterState = {
    count: number;
  };

  class BaseCounter extends Sigma<BaseCounterState> {
    constructor() {
      super({ count: 0 });
    }

    get doubled() {
      return this.count * 2;
    }

    increment() {
      this.count += 1;
    }
  }

  interface BaseCounter extends BaseCounterState {}

  class DerivedCounter extends BaseCounter {}

  const counter = new DerivedCounter();

  counter.increment();

  assert.equal(counter.count, 1);
  assert.equal(counter.doubled, 2);
});

test("sigma.captureState returns committed public state", () => {
  const counter = new Counter(1);

  assert.deepEqual(sigma.captureState(counter), { count: 1 });
  assert.equal(sigma.getSignal(counter, "count").value, 1);
  assert.equal(counter.doubled, 2);

  counter.increment();

  assert.deepEqual(sigma.captureState(counter), { count: 2 });
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

test("listen attaches and removes DOM target listeners", () => {
  const target = new EventTarget();
  const observed: string[] = [];
  const stop = listen(target, "sigma-v6-ping", (event) => {
    observed.push(event.type);
  });

  target.dispatchEvent(new Event("sigma-v6-ping"));
  stop();
  target.dispatchEvent(new Event("sigma-v6-ping"));

  assert.deepEqual(observed, ["sigma-v6-ping"]);
});

test("direct SigmaTarget instances emit outside actions", () => {
  const target = new SigmaTarget<{ changed: number; reset: void }>();
  const observed: string[] = [];
  const stopChanged = listen(target, "changed", (count) => {
    observed.push(`changed:${count}`);
  });
  const stopReset = listen(target, "reset", () => {
    observed.push("reset");
  });

  target.emit("changed", 1);
  target.emit("reset");
  stopChanged();
  stopReset();
  target.emit("changed", 2);

  assert.deepEqual(observed, ["changed:1", "reset"]);
});

test("direct SigmaTarget emit preserves unpublished draft boundaries", () => {
  const target = new SigmaTarget<{ changed: number }>();

  class SourceCounter extends Counter {
    notifyBeforeCommit() {
      this.count += 1;
      target.emit("changed", this.count);
    }
  }

  const source = new SourceCounter();

  assert.throws(() => {
    source.notifyBeforeCommit();
  }, /Draft for SourceCounter was not committed before an external action was invoked/);
  assert.equal(source.count, 0);
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

test("setup cleanup disposes function and object resources", () => {
  const cleanupOrder: string[] = [];

  class Store extends Sigma<{ ready: boolean }> {
    declare ready: boolean;

    constructor() {
      super({ ready: true });
    }

    onSetup() {
      return [
        {
          dispose() {
            cleanupOrder.push("dispose");
          },
        },
        {
          [Symbol.dispose]() {
            cleanupOrder.push("symbol");
          },
        },
        () => {
          cleanupOrder.push("function");
        },
      ];
    }
  }

  const cleanup = new Store().setup();

  cleanup();

  assert.deepEqual(cleanupOrder, ["function", "symbol", "dispose"]);
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

test("runtime guards reject unsupported action context operations", () => {
  class EventCounter extends SigmaTarget<{ changed: number }, { count: number }> {
    declare count: number;

    constructor() {
      super({ count: 0 });
    }

    emitBeforeCommit() {
      this.count += 1;
      this.emit("changed", this.count);
    }

    callActInsideSetupAction() {
      this.act(function () {
        this.act(function () {});
      });
    }

    onSetup() {
      this.callActInsideSetupAction();
      return [];
    }
  }

  const counter = new EventCounter();
  const observed: number[] = [];
  const stop = listen(counter, "changed", (count) => {
    observed.push(count);
  });

  assert.throws(() => {
    counter.count = 1;
  }, /Cannot set state property "count" outside an action/);
  assert.throws(() => {
    counter.commit();
  }, /Cannot commit\(\) from outside an action/);
  assert.throws(() => {
    counter.emit("changed", 1);
  }, /Cannot emit\(\) from outside an action/);
  assert.throws(() => {
    counter.emitBeforeCommit();
  }, /Cannot emit\(\) until you commit\(\) your draft/);
  assert.throws(() => {
    counter.setup();
  }, /Cannot act\(\) from inside an action/);

  assert.equal(counter.count, 0);
  assert.deepEqual(observed, []);
  stop();
});

test("private fields on sigma classes stay ordinary instance storage", async () => {
  const observed: Array<{ cached: number; count: number }> = [];

  class PrivateCounter extends SigmaTarget<
    { changed: { cached: number; count: number } },
    { count: number }
  > {
    declare count: number;
    #cache = new Map<string, number>();

    constructor() {
      super({ count: 0 });
    }

    #cachedCount() {
      return this.#cache.get("count") ?? 0;
    }

    get displayCount() {
      return this.count + this.#cachedCount();
    }

    cachedTotal(offset: number) {
      return this.count + this.#cachedCount() + offset;
    }

    cacheSnapshot() {
      return {
        act: this.#cache.get("act") ?? 0,
        count: this.#cache.get("count") ?? 0,
        setup: this.#cache.get("setup") ?? 0,
      };
    }

    increment() {
      this.#cache.set("count", this.#cachedCount() + 1);
      this.count += 1;
      this.commit();
      this.emit("changed", { cached: this.#cachedCount(), count: this.count });
    }

    async incrementLater() {
      await Promise.resolve();
      this.#cache.set("count", this.#cachedCount() + 1);
      this.count += 1;
      this.commit();
    }

    onSetup() {
      this.#cache.set("setup", 1);
      this.act(function () {
        this.#cache.set("act", 1);
        this.count += 1;
      });
      return [];
    }
  }

  PrivateCounter.prototype.cachedTotal = query(PrivateCounter.prototype.cachedTotal);

  const counter = new PrivateCounter();
  const stop = listen(counter, "changed", (event) => {
    observed.push(event);
  });

  counter.setup();
  counter.increment();
  await counter.incrementLater();

  assert.equal(counter.count, 3);
  assert.equal(counter.displayCount, 5);
  assert.equal(counter.cachedTotal(5), 10);
  assert.deepEqual(counter.cacheSnapshot(), { act: 1, count: 2, setup: 1 });
  assert.deepEqual(sigma.captureState(counter), { count: 3 });
  assert.deepEqual(observed, [{ cached: 1, count: 2 }]);
  assert.throws(() => {
    sigma.subscribe(counter, "#cache" as never, () => {});
  }, /not signal-backed/);

  stop();
});

test("private-field-only changes do not invalidate reactive reads", () => {
  class CacheCounter extends Sigma<{ count: number }> {
    declare count: number;
    #cache = 0;

    constructor() {
      super({ count: 0 });
    }

    get displayedCount() {
      return this.count + this.#cache;
    }

    bumpCache() {
      this.#cache += 1;
    }

    increment() {
      this.count += 1;
    }
  }

  const counter = new CacheCounter();
  const displayedCount = computed(() => counter.displayedCount);

  assert.equal(displayedCount.value, 0);

  counter.bumpCache();

  assert.equal(counter.displayedCount, 0);
  assert.equal(displayedCount.value, 0);

  counter.increment();

  assert.equal(displayedCount.value, 2);
});

test("actions reuse one draft and read computeds and queries from committed state", () => {
  class ReentrantCounter extends Counter {
    incrementTwiceWithChecks() {
      this.increment();
      assert.equal(this.count, 1);
      assert.equal(this.doubled, 0);
      assert.equal(this.isEven(), true);
      this.commit();
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

test("external action errors include the active draft owner", () => {
  class ExternalCounter extends Counter {}

  class SourceCounter extends Counter {
    #target: ExternalCounter;

    constructor(target: ExternalCounter) {
      super();
      this.#target = target;
    }

    invokeExternalAction() {
      this.count += 1;
      this.#target.increment();
    }
  }

  const target = new ExternalCounter();
  const source = new SourceCounter(target);

  assert.throws(() => {
    source.invokeExternalAction();
  }, /Draft for SourceCounter was not committed before an external action was invoked/);
  assert.equal(source.count, 0);
  assert.equal(target.count, 0);
});

test("query calls are reactive but not memoized across invocations", () => {
  class CountingQuery extends Counter {
    calls = 0;

    total(offset: number) {
      this.calls += 1;
      return this.count + offset;
    }
  }

  CountingQuery.prototype.total = query(CountingQuery.prototype.total);

  const counter = new CountingQuery();

  assert.equal(counter.total(1), 1);
  assert.equal(counter.total(1), 1);
  assert.equal(counter.calls, 2);

  counter.increment();

  assert.equal(counter.total(1), 2);
  assert.equal(counter.calls, 3);
});

test("computeds and queries cannot call actions", () => {
  class BadCounter extends Counter {
    get invalidComputed() {
      this.increment();
      return this.count;
    }

    invalidQuery() {
      this.increment();
      return this.count;
    }
  }

  BadCounter.prototype.invalidQuery = query(BadCounter.prototype.invalidQuery);

  const counter = new BadCounter();

  assert.throws(() => {
    void counter.invalidComputed;
  }, /Computeds and queries cannot call actions/);
  assert.equal(counter.count, 0);
  assert.throws(() => {
    counter.invalidQuery();
  }, /Computeds and queries cannot call actions/);
  assert.equal(counter.count, 0);
});

test("actions cannot return active drafts", () => {
  type InventoryState = {
    items: string[];
  };

  class Inventory extends Sigma<InventoryState> {
    declare items: string[];

    constructor() {
      super({ items: [] });
    }

    returnItems() {
      return this.items;
    }

    add(item: string) {
      this.items.push(item);
    }
  }

  const inventory = new Inventory();

  assert.throws(() => {
    inventory.returnItems();
  }, /returned an active draft/);
  inventory.add("ok");

  assert.deepEqual(inventory.items, ["ok"]);
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

test("async actions must commit drafts before resolving", async () => {
  class BadAsyncCounter extends Counter {
    async incrementWithoutCommit() {
      await Promise.resolve();
      this.count += 1;
    }
  }

  const counter = new BadAsyncCounter();

  await counter.incrementWithoutCommit().then(
    () => {
      assert.fail("expected action to reject");
    },
    (error) => {
      assert.instanceOf(error, Error);
      assert.match(error.message, /forgot to commit\(\) its draft before its promise resolved/);
    },
  );

  assert.equal(counter.count, 1);
});

test("rejected async actions clear unpublished draft state", async () => {
  class RejectingCounter extends Counter {
    async rejectAfterDraft() {
      await Promise.resolve();
      this.count += 1;
      throw new Error("boom");
    }
  }

  const counter = new RejectingCounter();

  await counter.rejectAfterDraft().then(
    () => {
      assert.fail("expected action to reject");
    },
    (error) => {
      assert.instanceOf(error, Error);
      assert.equal(error.message, "boom");
    },
  );

  assert.equal(counter.count, 0);

  counter.increment();

  assert.equal(counter.count, 1);
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
  const initial = sigma.captureState(counter);

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
  const initial = sigma.captureState(counter);

  sigma.replaceState(counter, initial);
  assert.deepEqual(observed, []);

  counter.increment();
  const changed = sigma.captureState(counter);
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
    sigma.replaceState(counter, sigma.captureState(counter));
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
